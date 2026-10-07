/** Keep the playable board visible while a capture prepares, sharing its baked piece meshes. */
import { createMemo, createSignal, onCleanup, Show, splitProps } from 'solid-js'
import { initialGummyBoardOrbit } from './gummyBoardCamera'
import { createGummyBoardRestMeshPool } from './gummyBoardRestMeshPool'
import { GummyMatchBoardScene } from './GummyMatchBoardScene'
import { GummyMatchCapture } from './GummyMatchCapture'
import { gummyMatchCaptureShot } from './gummyMatchPresentation'
import styles from './GummyMatchScene.module.css'
import type { ChessMoveReceipt, ChessPosition, } from '@chaos-master/core/chess/chessGame'
import type { GummyBoardQuality } from './gummyBoardQuality'
import type { GummyBoardTheme } from './gummyBoardThemes'
import type { GummyPresetSettings } from '@/pages/GummyBear/gummyPresets'

export type GummyMatchSceneProps = {
  position: ChessPosition
  receipt?: ChessMoveReceipt
  selectedSquare?: string
  legalSquares: readonly string[]
  settings: GummyPresetSettings
  quality: GummyBoardQuality
  scale: number
  theme: GummyBoardTheme
  onSquare: (square: string) => void
  onComplete: (receipt: ChessMoveReceipt) => void
  onError: (message: string) => void
  onReady?: (ready: boolean) => void
}

export function GummyMatchScene(props: GummyMatchSceneProps) {
  // Solid mergeProps treats undefined as fallback, so omit animated fields from the shared spread.
  const [, shared] = splitProps(props, [
    'position',
    'receipt',
    'selectedSquare',
    'legalSquares',
  ])
  const restMeshPool = createGummyBoardRestMeshPool()
  const orbit = initialGummyBoardOrbit('board')
  const [visibleReceipt, setVisibleReceipt] = createSignal<ChessMoveReceipt>()
  const [opacity, setOpacity] = createSignal(1)
  const capture = createMemo(() => {
    const receipt = props.receipt
    const shot = receipt && gummyMatchCaptureShot(receipt, props.theme)
    return receipt && shot ? { receipt, shot } : undefined
  })
  const captureVisible = createMemo(() => {
    const current = capture()
    return !!current && visibleReceipt() === current.receipt
  })
  const boardPosition = createMemo(() =>
    capture() && !captureVisible() ? capture()!.receipt.before : props.position,
  )
  const boardReceipt = createMemo(() => (capture() ? undefined : props.receipt))
  const boardSelection = createMemo(() =>
    capture() ? undefined : props.selectedSquare,
  )
  const boardLegal = createMemo(() => (capture() ? [] : props.legalSquares))
  const locked = createMemo(() => !!props.receipt)
  onCleanup(() => {
    restMeshPool.destroy()
  })
  return (
    <div class={styles.scene} data-capture-visible={captureVisible()}>
      <GummyMatchBoardScene
        {...shared}
        position={boardPosition()}
        receipt={boardReceipt()}
        selectedSquare={boardSelection()}
        legalSquares={boardLegal()}
        restMeshPool={restMeshPool}
        orbit={orbit}
        locked={locked()}
      />
      <Show when={capture()} keyed>
        {(current) => (
          <div
            class={styles.captureLayer}
            style={{ opacity: captureVisible() ? opacity() : 0 }}
            aria-hidden={!captureVisible()}
          >
            <GummyMatchCapture
              {...props}
              receipt={current.receipt}
              shot={current.shot}
              restMeshPool={restMeshPool}
              orbit={orbit}
              onOpacity={setOpacity}
              onReady={(ready) => {
                if (ready && props.receipt === current.receipt) {
                  setOpacity(1)
                  setVisibleReceipt(current.receipt)
                }
              }}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
