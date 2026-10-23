/** GPU density scatter, finite-difference normals and classic cube-case polygonization. */
import { d, std, tgpu } from 'typegpu'
import { marchingGummyCrossing, marchingGummyDensity, marchingGummyDrawCount, } from './marchingGummyMath'
import { MARCHING_GUMMY_CORNERS, MARCHING_GUMMY_EDGES, } from './marchingGummyTables'

export const MarchingGummyVertex = d.struct({
  position: d.vec4f,
  normal: d.vec4f,
  rest: d.vec4f,
})
export const MarchingGummyAccumulation = d.struct({
  density: d.atomic(d.u32),
  x: d.atomic(d.u32),
  y: d.atomic(d.u32),
  z: d.atomic(d.u32),
})
export const MarchingGummyNode = d.struct({ sample: d.vec4f })
export const MarchingGummyParameters = d.struct({
  originCell: d.vec4f,
  dimensions: d.vec4u,
  counts: d.vec4u,
  density: d.vec4f,
  dyeMin: d.vec4f,
  dyeRange: d.vec4f,
})
export const marchingGummyLayout = tgpu.bindGroupLayout({
  params: { uniform: MarchingGummyParameters },
  positions: { storage: d.arrayOf(d.vec4f) },
  rest: { storage: d.arrayOf(d.vec4f) },
  accumulations: {
    storage: d.arrayOf(MarchingGummyAccumulation),
    access: 'mutable',
  },
  nodes: { storage: d.arrayOf(MarchingGummyNode), access: 'mutable' },
  triangles: { storage: d.arrayOf(d.i32) },
  vertices: { storage: d.arrayOf(MarchingGummyVertex), access: 'mutable' },
  counter: { storage: d.atomic(d.u32), access: 'mutable' },
  indirect: { storage: d.arrayOf(d.u32), access: 'mutable' },
})
const corners = tgpu.const(
  d.arrayOf(d.vec3u, 8),
  MARCHING_GUMMY_CORNERS.map((point) => d.vec3u(point[0], point[1], point[2])),
)
const edges = tgpu.const(
  d.arrayOf(d.vec2u, 12),
  MARCHING_GUMMY_EDGES.map((edge) => d.vec2u(edge[0], edge[1])),
)

const nodeIndex = tgpu.fn(
  [d.vec3u],
  d.u32,
)((point) => {
  'use gpu'
  const dimensions = marchingGummyLayout.$.params.dimensions
  return point.x + dimensions.x * (point.y + dimensions.y * point.z)
})

const nodeDensity = tgpu.fn(
  [d.vec3i],
  d.f32,
)((point) => {
  'use gpu'
  const dimensions = marchingGummyLayout.$.params.dimensions
  if (
    std.any(std.lt(point, d.vec3i(0))) ||
    std.any(std.ge(point, d.vec3i(dimensions.xyz)))
  )
    return 0
  return marchingGummyLayout.$.nodes[nodeIndex(d.vec3u(point))]!.sample.w
})

const nodeGradient = tgpu.fn(
  [d.vec3u],
  d.vec3f,
)((coordinate) => {
  'use gpu'
  const point = d.vec3i(coordinate)
  return d.vec3f(
    nodeDensity(std.sub(point, d.vec3i(1, 0, 0))) -
      nodeDensity(std.add(point, d.vec3i(1, 0, 0))),
    nodeDensity(std.sub(point, d.vec3i(0, 1, 0))) -
      nodeDensity(std.add(point, d.vec3i(0, 1, 0))),
    nodeDensity(std.sub(point, d.vec3i(0, 0, 1))) -
      nodeDensity(std.add(point, d.vec3i(0, 0, 1))),
  )
})

export const marchingGummyScatter = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = marchingGummyLayout.$.params
  if (gid.x >= params.counts.x) return
  const point = marchingGummyLayout.$.positions[gid.x]!.xyz
  const cell = params.originCell.w
  const radius = params.density.x
  const low = std.max(
    d.vec3i(
      std.ceil(
        std.div(
          std.sub(std.sub(point, d.vec3f(radius)), params.originCell.xyz),
          cell,
        ),
      ),
    ),
    d.vec3i(0),
  )
  const high = std.min(
    d.vec3i(
      std.floor(
        std.div(
          std.sub(std.add(point, d.vec3f(radius)), params.originCell.xyz),
          cell,
        ),
      ),
    ),
    std.sub(d.vec3i(params.dimensions.xyz), d.vec3i(1)),
  )
  const dye = std.clamp(
    std.div(
      std.sub(marchingGummyLayout.$.rest[gid.x]!.xyz, params.dyeMin.xyz),
      params.dyeRange.xyz,
    ),
    d.vec3f(0),
    d.vec3f(1),
  )
  for (let z = d.i32(low.z); z <= high.z; z++) {
    for (let y = d.i32(low.y); y <= high.y; y++) {
      for (let x = d.i32(low.x); x <= high.x; x++) {
        const coordinate = d.vec3i(x, y, z)
        const world = std.add(
          params.originCell.xyz,
          std.mul(d.vec3f(coordinate), cell),
        )
        const density = marchingGummyDensity(
          std.sub(world, point),
          radius,
          params.density.y,
        )
        const fixed = d.u32(std.round(density * params.density.w))
        if (fixed > 0) {
          const index = nodeIndex(d.vec3u(coordinate))
          std.atomicAdd(
            marchingGummyLayout.$.accumulations[index]!.density,
            fixed,
          )
          std.atomicAdd(
            marchingGummyLayout.$.accumulations[index]!.x,
            d.u32(std.round(d.f32(fixed) * dye.x)),
          )
          std.atomicAdd(
            marchingGummyLayout.$.accumulations[index]!.y,
            d.u32(std.round(d.f32(fixed) * dye.y)),
          )
          std.atomicAdd(
            marchingGummyLayout.$.accumulations[index]!.z,
            d.u32(std.round(d.f32(fixed) * dye.z)),
          )
        }
      }
    }
  }
})

export const marchingGummyNormalize = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = marchingGummyLayout.$.params
  if (gid.x >= params.dimensions.w) return
  const id = gid.x
  const density = std.atomicLoad(
    marchingGummyLayout.$.accumulations[id]!.density,
  )
  if (density === 0) {
    marchingGummyLayout.$.nodes[id] = MarchingGummyNode()
    return
  }
  marchingGummyLayout.$.nodes[id] = MarchingGummyNode({
    sample: std.div(
      d.vec4f(
        d.f32(std.atomicLoad(marchingGummyLayout.$.accumulations[id]!.x)),
        d.f32(std.atomicLoad(marchingGummyLayout.$.accumulations[id]!.y)),
        d.f32(std.atomicLoad(marchingGummyLayout.$.accumulations[id]!.z)),
        d.f32(density),
      ),
      params.density.w,
    ),
  })
})

export const marchingGummyPolygonize = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const params = marchingGummyLayout.$.params
  if (gid.x >= params.counts.z) return
  const nx = params.dimensions.x - 1
  const ny = params.dimensions.y - 1
  const coordinate = d.vec3u(
    gid.x % nx,
    d.u32(gid.x / nx) % ny,
    d.u32(gid.x / (nx * ny)),
  )
  let cubeCase = d.u32(0)
  for (let corner = d.u32(0); corner < 8; corner++) {
    const index = nodeIndex(std.add(coordinate, corners.$[corner]!))
    if (marchingGummyLayout.$.nodes[index]!.sample.w < params.density.z)
      cubeCase |= d.u32(1) << corner
  }
  if (cubeCase === 0 || cubeCase === 255) return
  const tableStart = cubeCase * 16
  for (let triangle = d.u32(0); triangle < 15; triangle += 3) {
    if (marchingGummyLayout.$.triangles[tableStart + triangle]! < 0) break
    const offset = std.atomicAdd(marchingGummyLayout.$.counter, 3)
    if (offset + 3 > params.counts.y) continue
    for (let vertex = d.u32(0); vertex < 3; vertex++) {
      const edge =
        edges.$[
          d.u32(marchingGummyLayout.$.triangles[tableStart + triangle + vertex])
        ]!
      const a = std.add(coordinate, corners.$[edge.x]!)
      const b = std.add(coordinate, corners.$[edge.y]!)
      const first = marchingGummyLayout.$.nodes[nodeIndex(a)]!
      const second = marchingGummyLayout.$.nodes[nodeIndex(b)]!
      const t = marchingGummyCrossing(
        first.sample.w,
        second.sample.w,
        params.density.z,
      )
      const sample = std.mix(first.sample, second.sample, t)
      const gradient = std.mix(nodeGradient(a), nodeGradient(b), t)
      let normal = d.vec3f(0, 1, 0)
      if (std.dot(gradient, gradient) > 0.000000000001)
        normal = std.normalize(gradient)
      const world = std.add(
        params.originCell.xyz,
        std.mul(std.mix(d.vec3f(a), d.vec3f(b), t), params.originCell.w),
      )
      const rest = std.add(
        params.dyeMin.xyz,
        std.mul(
          std.div(sample.xyz, std.max(sample.w, 0.000001)),
          params.dyeRange.xyz,
        ),
      )
      marchingGummyLayout.$.vertices[offset + vertex] = MarchingGummyVertex({
        position: d.vec4f(world, 1),
        normal: d.vec4f(normal, 0),
        rest: d.vec4f(rest, 1),
      })
    }
  }
})

export const marchingGummyFinalize = tgpu.computeFn({ workgroupSize: [1] })(
  () => {
    'use gpu'
    marchingGummyLayout.$.indirect[0] = marchingGummyDrawCount(
      std.atomicLoad(marchingGummyLayout.$.counter),
      marchingGummyLayout.$.params.counts.y,
    )
    marchingGummyLayout.$.indirect[1] = 1
    marchingGummyLayout.$.indirect[2] = 0
    marchingGummyLayout.$.indirect[3] = 0
  },
)
