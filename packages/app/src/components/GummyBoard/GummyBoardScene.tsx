/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { createMemo, createSignal, Show } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { resolveGummyBoardQuality } from './gummyBoardQuality'
import { NativeGummyBoard } from './NativeGummyBoard'
import type { GummyBoardSceneProps } from './gummyBoardStudyContracts'

export type { GummyBoardSceneProps } from './gummyBoardStudyContracts'

export function GummyBoardScene(props: GummyBoardSceneProps) {
  const [visible, setVisible] = createSignal(true)
  const pinnedFeet = createMemo(() => props.settings.pinnedFeet)
  const collisionMode = createMemo(() => props.collisionMode ?? 'driven')
  const compact =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse), (max-width: 900px)').matches
  const qualityChoice = createMemo(() => props.quality ?? 'auto')
  const quality = createMemo(() =>
    resolveGummyBoardQuality(qualityChoice(), compact),
  )
  const model = createMemo(() => ({
    pinnedFeet: pinnedFeet(),
    collisionMode: collisionMode(),
    quality: quality(),
  }))
  return (
    <AutoCanvas
      pixelRatio={1}
      onVisibilityChange={setVisible}
      role="img"
      ariaLabel="Gummy chess board. Tap a piece to edit its color. Drag to orbit or use two fingers to pan. Grab mode stretches the active pawn. Space pauses and R resets."
    >
      <Show when={model()} keyed>
        {(selection) => (
          <NativeGummyBoard
            {...props}
            pinnedFeet={selection.pinnedFeet}
            collisionMode={selection.collisionMode}
            visible={visible()}
            renderQuality={selection.quality}
          />
        )}
      </Show>
    </AutoCanvas>
  )
}
