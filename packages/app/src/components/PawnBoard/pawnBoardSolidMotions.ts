/** Two transactional baked-contact slots, sharing solid meshes and reusing frame buffers. */
import { d } from 'typegpu'
import { instanceLayout } from './pawnBoardShaders'
import { contactChunkLayout, contactMotionLayout, ContactPose, contactVertex, } from './pawnContactShaders'
import { validateContactMotion } from './pawnContactValidation'
import { solidFragment, solidLayout } from './pawnSolidShaders'
import type { TgpuBindGroup, TgpuRenderPass, TgpuRenderPipeline, TgpuRoot, } from 'typegpu'
import type { cameraLayout } from './pawnBoardShaders'
import type { BoardPawnInstance } from './pawnBoardTypes'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'

export type ContactMeshBinding = {
  chunkCount: number
  vertexCount: number
  bind: (pipeline: TgpuRenderPipeline) => TgpuRenderPipeline
}

export function createPawnBoardSolidMotions(
  root: TgpuRoot,
  camera: TgpuBindGroup<typeof cameraLayout.entries>,
  meshFor: (key: string) => ContactMeshBinding | undefined,
  writeInstance: (
    data: Float32Array,
    index: number,
    piece: BoardPawnInstance,
  ) => void,
) {
  let pipeline: TgpuRenderPipeline | undefined
  const motions = new Map<string, ReturnType<typeof upload>>()

  function getPipeline() {
    if (pipeline) return pipeline
    const candidate = root
      .createRenderPipeline({
        attribs: {
          ...solidLayout.attrib,
          ...contactChunkLayout.attrib,
          ...instanceLayout.attrib,
        },
        vertex: contactVertex,
        fragment: solidFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'back' },
        depthStencil: {
          format: 'depth24plus',
          depthCompare: 'less-equal',
          depthWriteEnabled: true,
        },
        multisample: { count: 4 },
      })
      .with(camera)
    root.unwrap(candidate)
    pipeline = candidate
    return pipeline
  }

  function upload(motion: RookContactMotion) {
    const owned: { destroy(): void }[] = []
    const own = <T extends { destroy(): void }>(buffer: T) => {
      owned.push(buffer)
      return buffer
    }
    try {
      const base = getPipeline()
      const timing = own(
        root
          .createBuffer(
            d.vec4f,
            d.vec4f(motion.sampleRate, motion.frameCount, motion.chunkCount, 0),
          )
          .$usage('uniform'),
      )
      const poses = own(
        root
          .createBuffer(
            d.arrayOf(ContactPose, motion.frameCount * motion.chunkCount),
          )
          .$usage('storage'),
      )
      poses.write(new Float32Array(motion.poses).buffer)
      const instances = own(
        root.createBuffer(instanceLayout.schemaForCount(32)).$usage('vertex'),
      )
      const group = root.createBindGroup(contactMotionLayout, { timing, poses })
      const drawPipeline = base.with(group).with(instanceLayout, instances)
      root.unwrap(timing)
      root.unwrap(poses)
      root.unwrap(instances)
      return {
        chunkCount: motion.chunkCount,
        count: 0,
        data: new Float32Array(32 * 12),
        instances,
        drawPipeline,
        mesh: undefined as ContactMeshBinding | undefined,
        bound: undefined as TgpuRenderPipeline | undefined,
        destroy() {
          for (const buffer of owned) buffer.destroy()
        },
      }
    } catch (error) {
      for (const buffer of owned) buffer.destroy()
      throw error
    }
  }
  return {
    set(key: string, motion: RookContactMotion) {
      if (!key.trim()) throw new Error('Contact motion needs a nonempty key')
      if (!motions.has(key) && motions.size >= 2)
        throw new Error('Board contact motion capacity exceeded')
      validateContactMotion(motion)
      const next = upload(motion)
      motions.get(key)?.destroy()
      motions.set(key, next)
    },
    prepare(pieces: readonly BoardPawnInstance[]) {
      for (const motion of motions.values()) motion.count = 0
      for (const piece of pieces) {
        if (piece.solidMotionKey === undefined) continue
        const motion = motions.get(piece.solidMotionKey)
        const mesh =
          piece.solidKey === undefined ? undefined : meshFor(piece.solidKey)
        if (!motion || !mesh)
          throw new Error('Missing contact solid mesh or motion')
        if (mesh.chunkCount !== motion.chunkCount)
          throw new Error('Contact solid chunk count does not match motion')
        if (!Number.isFinite(piece.solidMotionTime))
          throw new Error('Contact motion time must be finite')
        if (motion.count >= 32)
          throw new Error('Board contact instance capacity exceeded')
        if (motion.count && motion.mesh !== mesh)
          throw new Error('A contact motion can drive only one shared mesh')
        if (motion.mesh !== mesh) {
          motion.mesh = mesh
          motion.bound = mesh.bind(motion.drawPipeline)
        }
        writeInstance(motion.data, motion.count, piece)
        motion.data[motion.count * 12 + 8] = piece.solidMotionTime!
        motion.count++
      }
    },
    write() {
      for (const motion of motions.values())
        if (motion.count) motion.instances.write(motion.data.buffer)
    },
    draw(pass: TgpuRenderPass) {
      for (const motion of motions.values())
        if (motion.count && motion.mesh && motion.bound)
          motion.bound.with(pass).draw(motion.mesh.vertexCount, motion.count)
    },
    clear() {
      for (const motion of motions.values()) motion.destroy()
      motions.clear()
    },
  }
}
