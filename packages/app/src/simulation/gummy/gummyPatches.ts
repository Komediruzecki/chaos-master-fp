/** Area-weighted failure completion on predefined, edge-connected cohesive seam patches. */
import { d, tgpu } from 'typegpu'
import { GummyDamage, GummyParameters } from './gummySolverShaders'

export const GUMMY_PATCH_FAILED_AREA_FRACTION = 0.7
export const GummyPatch = d.struct({
  offset: d.u32,
  count: d.u32,
  area: d.f32,
  pad: d.f32,
})
export const GummyPatchFace = d.struct({ id: d.u32, area: d.f32 })

/** Region pairs can meet on disconnected surfaces; shared edges, rather than pairs alone, define patches. */
export function prepareGummyPatches(mesh: {
  positions: Float32Array
  interfaces: Uint32Array
  nodeRegions?: Uint32Array
}) {
  if (!mesh.nodeRegions)
    return { patches: new ArrayBuffer(0), faces: new ArrayBuffer(0), count: 0 }
  const regions = mesh.nodeRegions
  const count = mesh.interfaces.length / 8
  const parent = Uint32Array.from({ length: count }, (_, id) => id)
  const areas = new Float32Array(count)
  const edges = new Map<string, number>()
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]!]!
      id = parent[id]!
    }
    return id
  }
  for (let face = 0; face < count; face++) {
    const offset = face * 8
    const sideA = regions[mesh.interfaces[offset]!]!
    const sideB = regions[mesh.interfaces[offset + 1]!]!
    const side = sideA <= sideB ? 0 : 1
    const ids = [0, 2, 4].map((pair) => mesh.interfaces[offset + pair + side]!)
    areas[face] = restFaceArea(mesh.positions, ids)
    if (!(areas[face]! > 0) || !Number.isFinite(areas[face]))
      throw new Error('Gummy patch faces must have positive finite rest area')
    const pair = `${Math.min(sideA, sideB)}:${Math.max(sideA, sideB)}`
    for (let edge = 0; edge < 3; edge++) {
      const a = ids[edge]!,
        b = ids[(edge + 1) % 3]!
      const key = `${pair}:${Math.min(a, b)}:${Math.max(a, b)}`
      const other = edges.get(key)
      if (other === undefined) edges.set(key, face)
      else parent[find(face)] = find(other)
    }
  }
  const groups = new Map<number, number[]>()
  for (let id = 0; id < count; id++) {
    const key = find(id)
    const group = groups.get(key) ?? []
    group.push(id)
    groups.set(key, group)
  }
  const patches = new ArrayBuffer(groups.size * d.sizeOf(GummyPatch))
  const headersU32 = new Uint32Array(patches),
    headersF32 = new Float32Array(patches)
  const faces = new ArrayBuffer(count * d.sizeOf(GummyPatchFace))
  const facesU32 = new Uint32Array(faces),
    facesF32 = new Float32Array(faces)
  let offset = 0,
    patch = 0
  for (const ids of groups.values()) {
    headersU32[patch * 4] = offset
    headersU32[patch * 4 + 1] = ids.length
    let total = 0
    for (const id of ids) {
      facesU32[offset * 2] = id
      facesF32[offset * 2 + 1] = areas[id]!
      total += areas[id]!
      offset++
    }
    headersF32[patch * 4 + 2] = total
    patch++
  }
  return { patches, faces, count: groups.size }
}

function restFaceArea(positions: Float32Array, ids: number[]) {
  const [a, b, c] = ids.map((id) =>
    Array.from(positions.subarray(id * 4, id * 4 + 3)),
  ) as [number[], number[], number[]]
  const u = b.map((v, axis) => v - a[axis]!),
    v = c.map((value, axis) => value - a[axis]!)
  return (
    Math.hypot(
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ) / 2
  )
}

export const gummyPatchShouldRelease = (
  failedArea: number,
  totalArea: number,
) => {
  'use gpu'
  return (
    totalArea > 0 && failedArea >= totalArea * GUMMY_PATCH_FAILED_AREA_FRACTION
  )
}

export const gummyPatchLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  count: { uniform: d.vec4u },
  patches: { storage: d.arrayOf(GummyPatch) },
  faces: { storage: d.arrayOf(GummyPatchFace) },
  damage: { storage: GummyDamage, access: 'mutable' },
})

/** A disjoint patch has one writer; fully failed rest area controls its residual ligament approximation. */
export const gummyCompletePatches = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (
    gid.x >= gummyPatchLayout.$.count.x ||
    gummyPatchLayout.$.params.controls.y < 0.5 ||
    gummyPatchLayout.$.params.fracture.x < 0.5
  )
    return
  const patch = gummyPatchLayout.$.patches[gid.x]!
  let failed = d.f32(0)
  for (let item = d.u32(0); item < patch.count; item++) {
    const face = gummyPatchLayout.$.faces[patch.offset + item]!
    if (gummyPatchLayout.$.damage[face.id]! >= 1) failed += face.area
  }
  if (!gummyPatchShouldRelease(failed, patch.area)) return
  // Coarse predefined-interface completion, not dynamic crack insertion or a fracture energy law.
  for (let item = d.u32(0); item < patch.count; item++)
    gummyPatchLayout.$.damage[
      gummyPatchLayout.$.faces[patch.offset + item]!.id
    ] = 1
})
