/** Bounded, transactional study-cloud uploads and batched board instances. */
import { createPawnBoardCloud } from './pawnBoardCloud'
import { instanceLayout } from './pawnBoardShaders'
import type { TgpuRenderPass, TgpuRenderPipeline, TgpuRoot } from 'typegpu'
import type { BoardPawnInstance } from './pawnBoardRenderer'
import type { PawnSide } from '@/flame/chess/pawnFlame'

const INSTANCE_CAPACITY = 32
const CLOUD_CAPACITY = 12

export function createPawnBoardVariants(
  root: TgpuRoot,
  pointPipeline: TgpuRenderPipeline,
  writeInstance: (
    data: Float32Array,
    index: number,
    instance: BoardPawnInstance,
  ) => void,
) {
  const variants = new Map<string, ReturnType<typeof upload>>()

  function createInstances() {
    return root
      .createBuffer(instanceLayout.schemaForCount(INSTANCE_CAPACITY))
      .$usage('vertex')
  }

  function upload(side: PawnSide, points: Float32Array, colors?: Float32Array) {
    const cloud = createPawnBoardCloud(root, side, points, colors, 'collection')
    let instances: ReturnType<typeof createInstances> | undefined
    try {
      // A slot owns its buffers independently of the renderer's fixed resources.
      instances = createInstances()
      const buffer = instances
      return {
        count: cloud.count,
        data: new Float32Array(INSTANCE_CAPACITY * 12),
        instanceCount: 0,
        buffer,
        pipeline: pointPipeline.with(cloud.group).with(instanceLayout, buffer),
        destroy() {
          cloud.destroy()
          buffer.destroy()
        },
      }
    } catch (error) {
      instances?.destroy()
      cloud.destroy()
      throw error
    }
  }

  return {
    set(
      key: string,
      side: PawnSide,
      points: Float32Array,
      colors?: Float32Array,
    ) {
      if (!key.trim()) throw new Error('A variant cloud needs a nonempty key')
      if (!variants.has(key) && variants.size >= CLOUD_CAPACITY)
        throw new Error('Board variant cloud capacity exceeded')
      const next = upload(side, points, colors)
      variants.get(key)?.destroy()
      variants.set(key, next)
    },
    prepare(pieces: readonly BoardPawnInstance[]) {
      for (const cloud of variants.values()) cloud.instanceCount = 0
      for (const piece of pieces) {
        if (piece.cloudKey === undefined) continue
        const cloud = variants.get(piece.cloudKey)
        if (!cloud)
          throw new Error(`Missing board variant cloud: ${piece.cloudKey}`)
        if (cloud.instanceCount >= INSTANCE_CAPACITY)
          throw new Error('Pawn board instance capacity exceeded')
        writeInstance(cloud.data, cloud.instanceCount++, piece)
      }
    },
    write() {
      for (const cloud of variants.values())
        if (cloud.instanceCount) cloud.buffer.write(cloud.data.buffer)
    },
    draw(pass: TgpuRenderPass) {
      for (const cloud of variants.values())
        if (cloud.instanceCount)
          cloud.pipeline.with(pass).draw(cloud.count * 6, cloud.instanceCount)
    },
    clear() {
      for (const cloud of variants.values()) cloud.destroy()
      variants.clear()
    },
  }
}
