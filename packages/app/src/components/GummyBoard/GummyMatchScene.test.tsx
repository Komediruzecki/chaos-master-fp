/** Capture preparation keeps the board mounted, ready and cancellable until its first GPU frame. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal, onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '@/pages/GummyBear/gummyBuiltinPresets'
import { GummyMatchScene } from './GummyMatchScene'
import type { ChessMoveReceipt } from '@chaos-master/core/chess/chessGame'
import type { ComponentProps } from 'solid-js'
import type { GummyMatchBoardScene } from './GummyMatchBoardScene'
import type { GummyMatchCapture } from './GummyMatchCapture'

const fixture = vi.hoisted(() => ({
  boards: [] as ComponentProps<typeof GummyMatchBoardScene>[],
  captures: [] as ComponentProps<typeof GummyMatchCapture>[],
  boardDestroyed: vi.fn(),
  poolDestroyed: vi.fn(),
}))
vi.mock('./gummyBoardRestMeshPool', () => ({
  createGummyBoardRestMeshPool: () => ({ destroy: fixture.poolDestroyed }),
}))
vi.mock('./GummyMatchBoardScene', () => ({
  GummyMatchBoardScene(props: ComponentProps<typeof GummyMatchBoardScene>) {
    fixture.boards.push(props)
    props.onReady?.(true)
    onCleanup(fixture.boardDestroyed)
    return <canvas data-testid="board" data-fen={props.position.fen} />
  },
}))
vi.mock('./GummyMatchCapture', () => ({
  GummyMatchCapture(props: ComponentProps<typeof GummyMatchCapture>) {
    fixture.captures.push(props)
    props.onReady?.(false)
    return <canvas data-testid="capture" />
  },
}))
const game = createChessGame('6k1/pp3ppp/4p3/3n4/4P3/8/PP3PPP/6K1 w - - 0 24')
const receipt = applyChessMove(game, { from: 'e4', to: 'd5' }).receipt

function setup() {
  const [current, setCurrent] = createSignal<ChessMoveReceipt>()
  const [position, setPosition] = createSignal(game.position)
  const ready = vi.fn()
  const result = render(() => (
    <GummyMatchScene
      position={position()}
      receipt={current()}
      legalSquares={['d5']}
      selectedSquare="e4"
      settings={GUMMY_BUILTIN_PRESETS[0]!.preset.settings}
      quality="high"
      scale={0.9}
      theme="glass"
      onSquare={() => {}}
      onComplete={() => {}}
      onError={() => {}}
      onReady={ready}
    />
  ))
  return {
    ...result,
    ready,
    start(value = receipt) {
      setPosition(value.after)
      setCurrent(value)
    },
    skip() {
      setCurrent(undefined)
    },
  }
}

beforeEach(() => {
  fixture.boards.length = 0
  fixture.captures.length = 0
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('persistent match capture transition', () => {
  it('keeps the original board visible until the cinematic has a completed frame', () => {
    const view = setup()
    const board = view.getByTestId('board')
    view.start()
    expect(view.getByTestId('board')).toBe(board)
    expect(board.getAttribute('data-fen')).toBe(receipt.before.fen)
    expect(fixture.boards).toHaveLength(1)
    expect(fixture.boards[0]!.receipt).toBeUndefined()
    expect(fixture.boards[0]!.locked).toBe(true)
    expect(fixture.boards[0]!.legalSquares).toEqual([])
    expect(view.getByTestId('capture').parentElement!.style.opacity).toBe('0')
    expect(view.ready.mock.calls).toEqual([[true]])
    fixture.captures[0]!.onReady?.(true)
    expect(view.getByTestId('capture').parentElement!.style.opacity).toBe('1')
    expect(board.getAttribute('data-fen')).toBe(receipt.after.fen)
    expect(fixture.boards[0]!.restMeshPool).toBe(
      fixture.captures[0]!.restMeshPool,
    )
    expect(fixture.boards[0]!.orbit).toBe(fixture.captures[0]!.orbit)
    view.skip()
    expect(view.queryByTestId('capture')).toBeNull()
    expect(view.getByTestId('board')).toBe(board)
    expect(fixture.boardDestroyed).not.toHaveBeenCalled()
    expect(view.ready.mock.calls).toEqual([[true]])
    view.unmount()
    expect(fixture.boardDestroyed).toHaveBeenCalledTimes(1)
    expect(fixture.poolDestroyed).toHaveBeenCalledTimes(1)
  })

  it('ignores late readiness after Skip and does not expose an unready replay', () => {
    const view = setup()
    view.start()
    const old = fixture.captures[0]!
    view.skip()
    old.onReady?.(true)
    expect(view.getByTestId('board').getAttribute('data-fen')).toBe(
      receipt.after.fen,
    )
    const replay = { ...receipt }
    view.start(replay)
    old.onReady?.(true)
    expect(view.getByTestId('capture').parentElement!.style.opacity).toBe('0')
    fixture.captures[1]!.onReady?.(true)
    expect(view.getByTestId('capture').parentElement!.style.opacity).toBe('1')
    fixture.captures[1]!.onOpacity(0.5)
    expect(view.getByTestId('capture').parentElement!.style.opacity).toBe('0.5')
    expect(fixture.boards).toHaveLength(1)
    expect(view.ready.mock.calls).toEqual([[true]])
  })

  it('leaves ordinary moves on the persistent board animation path', () => {
    const view = setup()
    const quiet = applyChessMove(game, { from: 'e4', to: 'e5' }).receipt
    view.start(quiet)
    expect(view.queryByTestId('capture')).toBeNull()
    expect(fixture.boards[0]!.receipt).toBe(quiet)
    expect(fixture.boards[0]!.position.fen).toBe(quiet.after.fen)
  })
})
