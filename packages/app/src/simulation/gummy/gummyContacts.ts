/** Dense fracture labels and GPU spatial-hash nodal contact; this approximates surface collision. */
import { d, std, tgpu } from 'typegpu'
import { GummyDamage, GummyInterface, GummyParameters, GummyPositions, } from './gummySolverShaders'

export const GUMMY_CONTACT_BUCKETS = 8192
const EMPTY = 0xffffffff

export function prepareGummyContacts(mesh: {
  positions: Float32Array
  interfaces: Uint32Array
  nodeRegions?: Uint32Array
  spacing?: number
}) {
  const count = mesh.positions.length / 4
  if (mesh.nodeRegions && mesh.nodeRegions.length !== count)
    throw new Error('Gummy contact regions must match node count')
  const regions = new Map<number, number>()
  const nodeRegions = new Uint32Array(count)
  const centers: number[][] = []
  for (let id = 0; id < count; id++) {
    const original = mesh.nodeRegions?.[id] ?? 0
    let region = regions.get(original)
    if (region === undefined) {
      region = regions.size
      regions.set(original, region)
      centers.push([0, 0, 0, 0])
    }
    nodeRegions[id] = region
    const center = centers[region]!
    for (let axis = 0; axis < 3; axis++)
      center[axis]! += mesh.positions[id * 4 + axis]!
    center[3]!++
  }
  const metadata = new Float32Array(count * 4)
  for (let id = 0; id < count; id++) {
    const region = nodeRegions[id]!,
      center = centers[region]!
    metadata.set(
      [
        center[0]! / center[3]!,
        center[1]! / center[3]!,
        center[2]! / center[3]!,
        region,
      ],
      id * 4,
    )
  }
  const interfaces = new Uint32Array(mesh.interfaces)
  for (let face = 0; face < interfaces.length; face += 8) {
    const a = nodeRegions[interfaces[face]!]!,
      b = nodeRegions[interfaces[face + 1]!]!
    for (let pair = 0; pair < 3; pair++)
      if (
        nodeRegions[interfaces[face + pair * 2]!] !== a ||
        nodeRegions[interfaces[face + pair * 2 + 1]!] !== b
      )
        throw new Error(
          'Gummy interface must join exactly two fracture regions',
        )
    interfaces[face + 6] = a
    interfaces[face + 7] = b
  }
  const spacing = Number.isFinite(mesh.spacing)
    ? Math.max(0.04, Math.min(0.3, mesh.spacing!))
    : 0.14
  return {
    metadata,
    interfaces,
    regionCount: regions.size,
    separation: spacing * 0.2,
  }
}

export const gummyContactLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyParameters },
  positions: { storage: GummyPositions, access: 'mutable' },
  snapshot: { storage: GummyPositions, access: 'mutable' },
  metadata: { storage: GummyPositions },
  interfaces: { storage: d.arrayOf(GummyInterface) },
  damage: { storage: GummyDamage },
  heads: { storage: d.arrayOf(d.atomic(d.u32)), access: 'mutable' },
  links: { storage: d.arrayOf(d.u32), access: 'mutable' },
  labels: { storage: d.arrayOf(d.atomic(d.u32)), access: 'mutable' },
})

/** Opposing mass-weighted corrections; a resting connected component never calls this. */
export const gummyProxyCorrection = (
  a: d.v4f,
  b: d.v4f,
  centerA: d.v3f,
  centerB: d.v3f,
  separation: number,
) => {
  'use gpu'
  const delta = std.sub(a.xyz, b.xyz)
  const distance = std.length(delta)
  if (distance >= separation || a.w <= 0) return d.vec3f(0)
  let direction = std.div(delta, std.max(distance, 0.000001))
  if (distance < 0.000001) {
    const centers = std.sub(centerA, centerB)
    direction = std.div(centers, std.max(std.length(centers), 0.000001))
  }
  return std.mul(
    direction,
    ((separation - distance) * a.w) / std.max(a.w + b.w, 0.000001),
  )
}

const contactHash = (cell: d.v3i) => {
  'use gpu'
  return (
    ((d.u32(cell.x) * 73856093) ^
      (d.u32(cell.y) * 19349663) ^
      (d.u32(cell.z) * 83492791)) &
    (GUMMY_CONTACT_BUCKETS - 1)
  )
}

/** Clear hash and restart component labels; damage can split yesterday's component. */
export const gummyContactReset = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (gid.x < GUMMY_CONTACT_BUCKETS)
    std.atomicStore(gummyContactLayout.$.heads[gid.x]!, EMPTY)
  if (gid.x < gummyContactLayout.$.params.counts.w)
    std.atomicStore(gummyContactLayout.$.labels[gid.x]!, gid.x)
})

/** One monotone graph sweep; regionCount sweeps cover every possible simple path exactly. */
export const gummyContactComponents = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  if (
    gid.x >= gummyContactLayout.$.params.counts.z ||
    gummyContactLayout.$.damage[gid.x]! >= 1
  )
    return
  const face = gummyContactLayout.$.interfaces[gid.x]!
  const a = std.atomicLoad(gummyContactLayout.$.labels[face.b.z]!)
  const b = std.atomicLoad(gummyContactLayout.$.labels[face.b.w]!)
  const label = std.min(a, b)
  std.atomicMin(gummyContactLayout.$.labels[face.b.z]!, label)
  std.atomicMin(gummyContactLayout.$.labels[face.b.w]!, label)
})

// TypeGPU 0.12 omits std.atomicExchange; this typed native builtin has identical integer semantics.
const exchangeHead = tgpu
  .fn([
      d.u32,
      d.u32,
    ], d.u32)(`(bucket: u32, value: u32) -> u32 { return atomicExchange(&layout.$.heads[bucket], value); }`)
  .$uses({ layout: gummyContactLayout })

/** Snapshot and insertion finish before gather; integer atomics only allocate linked-list entries. */
export const gummyContactInsert = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyContactLayout.$.params.counts.x) return
  const p = gummyContactLayout.$.positions[id]!
  gummyContactLayout.$.snapshot[id] = d.vec4f(p)
  const cell = d.vec3i(
    std.floor(std.div(p.xyz, gummyContactLayout.$.params.controls.z)),
  )
  const bucket = contactHash(cell)
  gummyContactLayout.$.links[id] = exchangeHead(bucket, id)
})

/** Jacobi nodal sphere proxy, capped and relaxed; no triangle CCD or frictional surface manifold. */
export const gummyContactGather = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})(({ gid }) => {
  'use gpu'
  const id = gid.x
  if (id >= gummyContactLayout.$.params.counts.x) return
  const p = gummyContactLayout.$.snapshot[id]!
  if (p.w <= 0) return
  const meta = gummyContactLayout.$.metadata[id]!
  const label = std.atomicLoad(gummyContactLayout.$.labels[d.u32(meta.w)]!)
  const separation = gummyContactLayout.$.params.controls.z
  const cell = d.vec3i(std.floor(std.div(p.xyz, separation)))
  let correction = d.vec3f(0)
  for (const dx of std.range(-1, 2)) {
    for (const dy of std.range(-1, 2)) {
      for (const dz of std.range(-1, 2)) {
        const wanted = std.add(cell, d.vec3i(dx, dy, dz))
        let other = std.atomicLoad(
          gummyContactLayout.$.heads[contactHash(wanted)]!,
        )
        let traversed = d.u32(0)
        while (
          other !== EMPTY &&
          traversed < gummyContactLayout.$.params.counts.x
        ) {
          const q = gummyContactLayout.$.snapshot[other]!
          const otherCell = d.vec3i(std.floor(std.div(q.xyz, separation)))
          const otherMeta = gummyContactLayout.$.metadata[other]!
          // Exact cell check prevents duplicate contributions from hash collisions among 27 cells.
          if (
            otherCell.x === wanted.x &&
            otherCell.y === wanted.y &&
            otherCell.z === wanted.z &&
            label !==
              std.atomicLoad(gummyContactLayout.$.labels[d.u32(otherMeta.w)]!)
          ) {
            correction = std.add(
              correction,
              gummyProxyCorrection(p, q, meta.xyz, otherMeta.xyz, separation),
            )
          }
          other = gummyContactLayout.$.links[other]!
          traversed++
        }
      }
    }
  }
  correction = std.mul(correction, 0.35)
  correction = std.mul(
    correction,
    std.min(
      1,
      gummyContactLayout.$.params.controls.w /
        std.max(std.length(correction), 0.000001),
    ),
  )
  gummyContactLayout.$.positions[id] = d.vec4f(std.add(p.xyz, correction), p.w)
})
