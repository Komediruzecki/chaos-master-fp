/** Bounded hollow-shell meshes, batched instances and shared optical passes for art studies. */
import { instanceLayout, meshLayout } from './pawnBoardShaders'
import type { TgpuRenderPass, TgpuRenderPipeline, TgpuRoot } from 'typegpu'
import type { BoardPawnInstance } from './pawnBoardRenderer'

const SHELL_CAPACITY = 3
const INSTANCE_CAPACITY = 32
const MAX_VERTICES = 120_000

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
  const createInstances = () =>
    root
      .createBuffer(instanceLayout.schemaForCount(INSTANCE_CAPACITY))
      .$usage('vertex')

  function upload(vertices: Float32Array, radius: number) {
    let mesh: ReturnType<typeof createMesh> | undefined
    let instances: ReturnType<typeof createInstances> | undefined
    try {
      mesh = createMesh(vertices.length / 6)
      // Copy the view, rather than its backing buffer, so subarray uploads are exact.
      mesh.write(new Float32Array(vertices).buffer)
      instances = createInstances()
      // Allocate now so switching a prepared pure study to glass does not
      // introduce a deferred vertex-buffer allocation on its first draw.
      root.unwrap(instances)
      const meshBuffer = mesh,
        instanceBuffer = instances
      return {
        count: vertices.length / 6,
        radius,
        mesh: meshBuffer,
        instances: instanceBuffer,
        data: new Float32Array(INSTANCE_CAPACITY * 12),
        instanceCount: 0,
        destroy() {
          meshBuffer.destroy()
          instanceBuffer.destroy()
        },
      }
    } catch (error) {
      mesh?.destroy()
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
      for (const shell of variants.values()) shell.instanceCount = 0
      let count = firstId
      for (const piece of pieces) {
        if (piece.glassKey === undefined || piece.age >= 0) continue
        const shell = variants.get(piece.glassKey)
        if (!shell)
          throw new Error(`Missing board variant glass: ${piece.glassKey}`)
        if (count >= INSTANCE_CAPACITY)
          throw new Error('Board glass instance capacity exceeded')
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
      for (const shell of variants.values())
        if (shell.instanceCount) shell.instances.write(shell.data.buffer)
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
