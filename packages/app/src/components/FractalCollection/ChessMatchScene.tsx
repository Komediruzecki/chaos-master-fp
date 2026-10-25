/** Choose a native particle presentation or the existing gummy solver for the same legal match. */
import { createMemo, Show, splitProps } from 'solid-js'
import { effectiveNativeFracture } from '@/flame/chess/nativeFractureTypes'
import { nativeMatchCaptureFracture } from '@/pages/GummyBoard/nativeMatchFracture'
import { GummyMatchScene } from '../GummyBoard/GummyMatchScene'
import { NativeFractalMatchScene } from './NativeFractalMatchScene'
import type { GummyMatchSceneProps } from '../GummyBoard/GummyMatchScene'
import type { NativeFractureMode } from '@/flame/chess/nativeFractureTypes'
import type { NativeChessCollectionSelection } from '@/pages/GummyBoard/gummyMatchAppearance'

export function ChessMatchScene(
  props: GummyMatchSceneProps & {
    nativeCollection?: NativeChessCollectionSelection
    nativeFracture?: NativeFractureMode
  },
) {
  const [, gummyProps] = splitProps(props, [
    'nativeCollection',
    'nativeFracture',
  ])
  const fracture = createMemo(() =>
    props.receipt?.captured?.role === 'rook'
      ? nativeMatchCaptureFracture(
          props.receipt,
          props.presentation,
          props.nativeCollection?.id ?? '',
        )
      : effectiveNativeFracture(
          props.nativeCollection?.id ?? '',
          props.nativeFracture,
        ),
  )

  function reportReady(ready: boolean) {
    // Keep fatal renderer errors actionable until a new renderer actually succeeds.
    if (ready) props.onError('')
    props.onReady?.(ready)
  }
  return (
    <Show
      when={!!props.nativeCollection}
      fallback={<GummyMatchScene {...gummyProps} onReady={reportReady} />}
    >
      <NativeFractalMatchScene
        position={props.position}
        receipt={props.receipt}
        selectedSquare={props.selectedSquare}
        legalSquares={props.legalSquares}
        collectionId={props.nativeCollection!.id}
        enclosure={props.nativeCollection!.enclosure}
        scale={props.scale}
        fracture={fracture()}
        onSquare={props.onSquare}
        onComplete={props.onComplete}
        onReady={reportReady}
        onError={props.onError}
      />
    </Show>
  )
}
