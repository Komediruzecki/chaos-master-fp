/** A world-space sizing guide projected by the same camera as the native flame. */
import { createEffect } from 'solid-js'
import { useCamera3D } from '@/lib/Camera3DContext'
import { useCanvas } from '@/lib/CanvasContext'
import ui from './PawnStage.module.css'

type WorldPoint = readonly [number, number, number]

export type PawnFitGuideSize = { squareSize: number; height: number }

export function PawnFitGuide(props: { size: PawnFitGuideSize }) {
  const camera = useCamera3D()
  const { canvasSize } = useCanvas()
  let guide: HTMLCanvasElement | undefined
  createEffect(() => {
    const size = canvasSize()
    const reference = props.size
    const position = camera.position()
    const target = camera.target()
    if (!guide || !size.width || !size.height) return
    guide.width = size.width
    guide.height = size.height
    const ctx = guide.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size.width, size.height)
    if (!(reference.squareSize > 0) || !(reference.height > 0)) return
    const forward = target.map((value, index) => value - position[index]!)
    const forwardLength = Math.hypot(...forward)
    const project = (world: WorldPoint): [number, number] | undefined => {
      const depth =
        forward.reduce(
          (sum, value, index) =>
            sum + value * (world[index]! - position[index]!),
          0,
        ) / forwardLength
      if (depth <= 0.01) return undefined
      // Reads the actual view/projection uniforms, including roll and the
      // stage's portrait-aspect fit, under this owned reactive effect.
      const clip = camera.js.worldToClip(new Float32Array(world))
      if (!Number.isFinite(clip[0]) || !Number.isFinite(clip[1]))
        return undefined
      return [
        (clip[0]! * 0.5 + 0.5) * size.width,
        (0.5 - clip[1]! * 0.5) * size.height,
      ]
    }
    const h = reference.squareSize / 2
    const floor: WorldPoint[] = [
      [-h, 0, -h],
      [h, 0, -h],
      [h, 0, h],
      [-h, 0, h],
    ]
    const pixelScale = size.height / Math.max(1, guide.clientHeight)
    ctx.lineWidth = 1.2 * pixelScale
    ctx.strokeStyle = 'rgba(159, 209, 213, 0.8)'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 3 * pixelScale
    const line = (from: WorldPoint, to: WorldPoint) => {
      const a = project(from)
      const b = project(to)
      if (!a || !b) return
      ctx.beginPath()
      ctx.moveTo(...a)
      ctx.lineTo(...b)
      ctx.stroke()
    }
    for (let index = 0; index < floor.length; index++)
      line(floor[index]!, floor[(index + 1) % floor.length]!)
    ctx.setLineDash([4 * pixelScale, 5 * pixelScale])
    line([-h, 0, h], [-h, reference.height, h])
    line([-h, reference.height, h], [h, reference.height, h])
    ctx.setLineDash([])
    const label = project([-h, reference.height, h])
    if (label) {
      ctx.fillStyle = 'rgba(197, 236, 237, 0.95)'
      ctx.font = `${12 * pixelScale}px sans-serif`
      ctx.fillText(
        `${reference.height.toFixed(2)} high`,
        label[0] + 6 * pixelScale,
        label[1] - 6 * pixelScale,
      )
    }
  })
  return (
    <canvas
      ref={guide}
      class={ui.fitGuide}
      aria-hidden="true"
      data-testid="pawn-fit-guide"
    />
  )
}
