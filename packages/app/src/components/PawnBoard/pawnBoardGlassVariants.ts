/** Bounded hollow-shell meshes, batched instances and shared optical passes for art studies. */
import { fragmentLayout, GLASS_FRAGMENT_DURATION, instanceLayout, meshLayout, } from './pawnBoardShaders'
import type { TgpuRenderPass, TgpuRenderPipeline, TgpuRoot } from 'typegpu'
import type { BoardPawnInstance } from './pawnBoardTypes'

const SHELL_CAPACITY = 3
const INSTANCE_CAPACITY = 32
const MAX_VERTICES = 120_000

/** Exact uploaded triangles share deterministic rigid motion in 12 x 8 shell sectors. */
export function packVariantGlassFragments(vertices: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < vertices.length; offset += 6)
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, vertices[offset + axis]!)
      max[axis] = Math.max(max[axis]!, vertices[offset + axis]!)
    }
  const centreX = (min[0]! + max[0]!) / 2
  const centreZ = (min[2]! + max[2]!) / 2
  const height = Math.max(0.001, max[1]! - min[1]!)
  const clusters = new Map<number, { centre: number[]; triangles: number[] }>()
  for (let offset = 0; offset < vertices.length; offset += 18) {
    const centre = [0, 1, 2].map(
      (axis) =>
        (vertices[offset + axis]! +
          vertices[offset + 6 + axis]! +
          vertices[offset + 12 + axis]!) /
        3,
    )
    const angle = Math.atan2(centre[2]! - centreZ, centre[0]! - centreX)
    const sector = Math.min(
      11,
      Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12),
    )
    const band = Math.min(
      7,
      Math.max(0, Math.floor(((centre[1]! - min[1]!) / height) * 8)),
    )
    const id = band * 12 + sector
    let cluster = clusters.get(id)
    if (!cluster) {
      cluster = { centre: [0, 0, 0], triangles: [] }
      clusters.set(id, cluster)
    }
    for (let axis = 0; axis < 3; axis++)
      cluster.centre[axis] = cluster.centre[axis]! + centre[axis]!
    cluster.triangles.push(offset)
  }
  const packed = new Float32Array((vertices.length / 6) * 15)
  const noise = (id: number, salt: number) => {
    const value = Math.imul(id + 1, 1664525) ^ Math.imul(salt + 1, 1013904223)
    return (value >>> 0) / 0xffffffff
  }
  for (const [id, cluster] of clusters) {
    const centre = cluster.centre.map(
      (value) => value / cluster.triangles.length,
    )
    const angle = (((id % 12) + 0.5) / 12) * Math.PI * 2 - Math.PI
    const speed = 0.55 + noise(id, 0) * 0.8
    const velocity = [
      Math.cos(angle) * speed,
      0.4 + noise(id, 1) * 0.9,
      Math.sin(angle) * speed,
    ]
    const angular = [2, 3, 4].map((salt) => (noise(id, salt) - 0.5) * 6)
    for (const triangle of cluster.triangles)
      for (const vertex of [0, 6, 12]) {
        const offset = ((triangle + vertex) / 6) * 15
        for (let axis = 0; axis < 3; axis++)
          packed[offset + axis] =
            vertices[triangle + vertex + axis]! - centre[axis]!
        packed.set(
          vertices.subarray(triangle + vertex + 3, triangle + vertex + 6),
          offset + 3,
        )
        packed.set(centre, offset + 6)
        packed.set(velocity, offset + 9)
        packed.set(angular, offset + 12)
      }
  }
  return packed
}

export function createPawnBoardGlassVariants(
  root: TgpuRoot,
  writeInstance: (
    data: Float32Array,
    index: number,
    instance: BoardPawnInstance,
  ) => void,
) {
  const variants = new Map<string, ReturnType<typeof upload>>()
  const createMesh = (count: number) =>
    root.createBuffer(meshLayout.schemaForCount(count)).$usage('vertex')
  const createFragments = (count: number) =>
    root.createBuffer(fragmentLayout.schemaForCount(count)).$usage('vertex')
  const createInstances = () =>
    root
      .createBuffer(instanceLayout.schemaForCount(INSTANCE_CAPACITY))
      .$usage('vertex')

  function upload(vertices: Float32Array, radius: number) {
    let mesh: ReturnType<typeof createMesh> | undefined
    let fragments: ReturnType<typeof createFragments> | undefined
    let fragmentInstances: ReturnType<typeof createInstances> | undefined
    let instances: ReturnType<typeof createInstances> | undefined
    try {
      mesh = createMesh(vertices.length / 6)
      // Copy the view, rather than its backing buffer, so subarray uploads are exact.
      mesh.write(new Float32Array(vertices).buffer)
      fragments = createFragments(vertices.length / 6)
      fragments.write(packVariantGlassFragments(vertices).buffer)
      fragmentInstances = createInstances()
      root.unwrap(fragmentInstances)
      instances = createInstances()
      // Allocate now so switching a prepared pure study to glass does not
      // introduce a deferred vertex-buffer allocation on its first draw.
      root.unwrap(instances)
      const meshBuffer = mesh,
        fragmentBuffer = fragments,
        fragmentInstanceBuffer = fragmentInstances,
        instanceBuffer = instances
      return {
        count: vertices.length / 6,
        radius,
        mesh: meshBuffer,
        instances: instanceBuffer,
        fragments: fragmentBuffer,
        fragmentInstances: fragmentInstanceBuffer,
        fragmentData: new Float32Array(INSTANCE_CAPACITY * 12),
        fragmentCount: 0,
        data: new Float32Array(INSTANCE_CAPACITY * 12),
        instanceCount: 0,
        destroy() {
          meshBuffer.destroy()
          fragmentBuffer.destroy()
          fragmentInstanceBuffer.destroy()
          instanceBuffer.destroy()
        },
      }
    } catch (error) {
      mesh?.destroy()
      fragments?.destroy()
      fragmentInstances?.destroy()
      instances?.destroy()
      throw error
    }
  }

  return {
    set(key: string, vertices: Float32Array, radius: number) {
      if (!key.trim())
        throw new Error('A variant glass shell needs a nonempty key')
      if (!variants.has(key) && variants.size >= SHELL_CAPACITY)
        throw new Error('Board variant glass capacity exceeded')
      if (
        vertices.length === 0 ||
        vertices.length % 18 !== 0 ||
        vertices.length / 6 > MAX_VERTICES ||
        !vertices.every(Number.isFinite)
      )
        throw new Error(
          'Variant glass needs finite packed position/normal triangles within capacity',
        )
      if (!Number.isFinite(radius) || radius <= 0)
        throw new Error('Variant glass radius must be finite and positive')
      for (let index = 0; index < vertices.length; index += 6) {
        if (
          Math.hypot(
            vertices[index + 3]!,
            vertices[index + 4]!,
            vertices[index + 5]!,
          ) < 1e-6
        )
          throw new Error('Variant glass normals must be nonzero')
      }
      const next = upload(vertices, radius)
      variants.get(key)?.destroy()
      variants.set(key, next)
    },
    prepare(
      pieces: readonly BoardPawnInstance[],
      cameraData: Float32Array,
      firstId: number,
    ) {
      for (const shell of variants.values()) {
        shell.instanceCount = 0
        shell.fragmentCount = 0
      }
      let count = firstId
      let total = firstId
      for (const piece of pieces) {
        if (piece.glassKey === undefined) continue
        const age = piece.glassAge ?? -1
        if (!Number.isFinite(age))
          throw new Error('Board glass fracture age must be finite')
        const shell = variants.get(piece.glassKey)
        if (!shell)
          throw new Error(`Missing board variant glass: ${piece.glassKey}`)
        if (total++ >= INSTANCE_CAPACITY)
          throw new Error('Board glass instance capacity exceeded')
        if (age >= GLASS_FRAGMENT_DURATION) continue
        if (age >= 0) {
          const index = shell.fragmentCount++
          writeInstance(shell.fragmentData, index, piece)
          shell.fragmentData[index * 12 + 8] = age
          continue
        }
        const index = shell.instanceCount++
        writeInstance(shell.data, index, piece)
        shell.data[index * 12 + 10] = count + 1
        const centre = 28 + count * 4
        cameraData[centre] = piece.position[0]
        cameraData[centre + 1] = piece.position[1]
        cameraData[centre + 2] = piece.position[2]
        cameraData[centre + 3] = shell.radius * (piece.scale ?? 1)
        count++
      }
      cameraData[24] = count
      return count - firstId
    },
    write() {
      for (const shell of variants.values()) {
        if (shell.instanceCount) shell.instances.write(shell.data.buffer)
        if (shell.fragmentCount)
          shell.fragmentInstances.write(shell.fragmentData.buffer)
      }
    },
    drawFragments(
      pass: TgpuRenderPass,
      pipeline: TgpuRenderPipeline,
      visible: boolean,
    ) {
      for (const shell of variants.values())
        if (visible && shell.fragmentCount)
          pipeline
            .with(fragmentLayout, shell.fragments)
            .with(instanceLayout, shell.fragmentInstances)
            .with(pass)
            .draw(shell.count, shell.fragmentCount)
    },
    draw(pass: TgpuRenderPass, pipeline: TgpuRenderPipeline) {
      for (const shell of variants.values())
        if (shell.instanceCount)
          pipeline
            .with(meshLayout, shell.mesh)
            .with(instanceLayout, shell.instances)
            .with(pass)
            .draw(shell.count, shell.instanceCount)
    },
    clear() {
      for (const shell of variants.values()) shell.destroy()
      variants.clear()
    },
  }
}
