/** Choose a native particle presentation or the existing gummy solver for the same legal match. */
import { Show, splitProps } from 'solid-js'
import { GummyMatchScene } from '../GummyBoard/GummyMatchScene'
import { NativeFractalMatchScene } from './NativeFractalMatchScene'
import type { GummyMatchSceneProps } from '../GummyBoard/GummyMatchScene'
import type { NativeChessCollectionSelection } from '@/pages/GummyBoard/gummyMatchAppearance'

export function ChessMatchScene(
  props: GummyMatchSceneProps & {
    nativeCollection?: NativeChessCollectionSelection
  },
) {
  const [, gummyProps] = splitProps(props, ['nativeCollection'])

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
        onSquare={props.onSquare}
        onComplete={props.onComplete}
        onReady={reportReady}
        onError={props.onError}
      />
    </Show>
  )
}
