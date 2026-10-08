/** Receipt-scoped cinematic playback with safe cancellation and a short return dissolve. */
import { onCleanup } from 'solid-js'
import { GummyCinemaScene } from './GummyCinemaScene'
import { gummyMatchPalettes } from './gummyMatchPresentation'
import type { GummyOrbit } from '../GummyBear/gummyStudyMath'
import type { GummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import type { GummyBoardShot } from './gummyBoardShots'
import type { GummyCinemaController } from './GummyCinemaScene'
import type { GummyMatchSceneProps } from './GummyMatchScene'

export function GummyMatchCapture(
  props: GummyMatchSceneProps & {
    shot: GummyBoardShot
    restMeshPool: GummyBoardRestMeshPool
    orbit: GummyOrbit
    onOpacity: (opacity: number) => void
  },
) {
  let controller: GummyCinemaController | undefined
  let disposed = false
  let started = false
  let completed = false
  const receipt = props.receipt!
  const palettes = gummyMatchPalettes(props.settings.palette)
  const attackerPalette =
    receipt.before.pieces.find((p) => p.id === receipt.pieceId)!.color === 'w'
      ? palettes[0]
      : palettes[1]
  const victimPalette =
    receipt.captured!.color === 'w' ? palettes[0] : palettes[1]
  onCleanup(() => {
    disposed = true
    controller?.pause()
  })
  return (
    <GummyCinemaScene
      shot={props.shot}
      material={props.settings}
      scale={props.scale}
      quality={props.quality}
      artStyle="sculpted"
      authoredPawn={props.authoredPawn}
      attackerPalette={attackerPalette}
      victimPalette={victimPalette}
      backgroundPalettes={palettes}
      restMeshPool={props.restMeshPool}
      matchOrbit={props.orbit}
      onController={(value) => {
        controller = value
      }}
      onReady={(ready) => {
        if (disposed) return
        props.onReady?.(ready)
        if (ready && !started && controller) {
          started = true
          controller.play()
        }
      }}
      onError={(message) => {
        if (!disposed) props.onError(message)
      }}
      onProgress={(time) => {
        if (!disposed)
          props.onOpacity(Math.min(1, Math.max(0, (8 - time) / 0.18)))
        if (
          !disposed &&
          !completed &&
          time >= (controller?.info().displayDuration ?? 8)
        ) {
          completed = true
          // Let the last GPU submission return before unmounting its resources.
          queueMicrotask(() => {
            if (!disposed) props.onComplete(receipt)
          })
        }
      }}
    />
  )
}
