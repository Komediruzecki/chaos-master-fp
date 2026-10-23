/** Alpha-blended pointer cues render into the same WebGPU canvas as the recorded gummy scene. */
import { d } from 'typegpu'
import { gummyPointerFragment, gummyPointerLayout, GummyPointerUniform, gummyPointerVertex, } from './gummyPointerShaders'
import type { TgpuRoot } from 'typegpu'

export type GummyPointerState = {
  /** Canvas-normalized pointer position, measured from the upper-left corner. */
  x: number
  y: number
  active: boolean
  /** Actual world-space handle target, not a sampled material surface position. */
  target?: readonly [number, number, number]
  /** Initial world-space grab point. */
  origin?: readonly [number, number, number]
}
export type GummyPointerFrame = {
  width: number
  height: number
  viewProjection: ArrayLike<number>
  pointer?: GummyPointerState
}

const cameraOffset =
  d.memoryLayoutOf(GummyPointerUniform, (uniform) => uniform.viewProjection)
    .offset / 4
const viewportOffset =
  d.memoryLayoutOf(GummyPointerUniform, (uniform) => uniform.viewport).offset /
  4
const pointerOffset =
  d.memoryLayoutOf(GummyPointerUniform, (uniform) => uniform.pointer).offset / 4
const targetOffset =
  d.memoryLayoutOf(GummyPointerUniform, (uniform) => uniform.endPoint).offset /
  4
const originOffset =
  d.memoryLayoutOf(GummyPointerUniform, (uniform) => uniform.startPoint)
    .offset / 4

function visiblePointerFrame(
  frame: GummyPointerFrame,
): frame is GummyPointerFrame & { pointer: GummyPointerState } {
  const pointer = frame.pointer
  if (
    !pointer ||
    !Number.isFinite(frame.width + frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    !Number.isFinite(pointer.x + pointer.y) ||
    frame.viewProjection.length !== 16
  )
    return false
  return (
    pointer.active ||
    (pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1)
  )
}

/** Pack one cached uniform; missing, outside or invalid hover state submits no GPU work. */
export function packGummyPointerFrame(
  data: Float32Array,
  frame: GummyPointerFrame,
  srgb = false,
) {
  if (!visiblePointerFrame(frame)) return false
  const pointer = frame.pointer
  for (let i = 0; i < 16; i++) {
    const value = frame.viewProjection[i]!
    if (!Number.isFinite(value)) return false
    data[cameraOffset + i] = value
  }
  const target = pointer.target?.every(Number.isFinite)
    ? pointer.target
    : undefined
  const origin = pointer.origin?.every(Number.isFinite)
    ? pointer.origin
    : undefined
  data[viewportOffset] = frame.width
  data[viewportOffset + 1] = frame.height
  data[viewportOffset + 2] = Number(pointer.active)
  data[viewportOffset + 3] = Number(srgb)
  data[pointerOffset] = pointer.x
  data[pointerOffset + 1] = pointer.y
  data[pointerOffset + 2] = Number(!!target)
  data[pointerOffset + 3] = Number(!!origin)
  for (let i = 0; i < 4; i++) {
    data[targetOffset + i] = target?.[i] ?? 0
    data[originOffset + i] = origin?.[i] ?? 0
  }
  return true
}

export function createGummyPointerRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
) {
  if (root.device !== device)
    throw new Error('Gummy pointer root and device must match')
  const uniform = root.createBuffer(GummyPointerUniform).$usage('uniform')
  try {
    const data = new Float32Array(d.sizeOf(GummyPointerUniform) / 4)
    const group = root.createBindGroup(gummyPointerLayout, { pointer: uniform })
    const pipeline = root
      .createRenderPipeline({
        vertex: gummyPointerVertex,
        fragment: gummyPointerFragment,
        targets: {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      })
      .with(group)
    root.unwrap(pipeline)
    let disposed = false
    const srgb = format.endsWith('-srgb')
    return {
      render(frame: GummyPointerFrame) {
        if (disposed || !packGummyPointerFrame(data, frame, srgb)) return
        uniform.write(data.buffer)
        const encoder = device.createCommandEncoder({
          label: 'Gummy pointer overlay',
        })
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp: 'load',
              storeOp: 'store',
            },
          ],
        })
        pipeline.with(pass).draw(6, 3)
        pass.end()
        device.queue.submit([encoder.finish()])
      },
      destroy() {
        if (disposed) return
        disposed = true
        uniform.destroy()
      },
    }
  } catch (error) {
    uniform.destroy()
    throw error
  }
}
