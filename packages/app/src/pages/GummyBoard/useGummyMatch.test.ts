/** Capture effects survive replay and session recovery without altering the legal game or future branch. */
import { cleanup, renderHook } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BOARD_EARLY_SHEAR_MOTION } from '@/components/GummyBoard/gummyBoardShots'
import { createGummyMatchCinemaRecipe, GUMMY_MATCH_SESSION_KEY, loadGummyMatchSession, } from './gummyMatchSession'
import { useGummyMatch } from './useGummyMatch'

beforeEach(() => {
  const entries = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const line = '1. e4 d5 2. exd5 Qxd5 3. Nc3 *'

function matchAtCapture() {
  const { result: match } = renderHook(useGummyMatch)
  expect(match.importPgn(line)).toBe(true)
  match.seek(3)
  return match
}

describe('saved capture presentation', () => {
  it('keeps the original straight press in the rotation across imported captures, reload and new moves', () => {
    const { result: initial } = renderHook(useGummyMatch)
    expect(initial.importPgn('1. e4 d5 2. exd5 Qxd5 *')).toBe(true)
    initial.seek(4)
    const firstTwo = structuredClone(loadGummyMatchSession().session!.captures!)
    const { result: match } = renderHook(useGummyMatch)
    for (const [from, to] of [
      ['b1', 'c3'],
      ['d5', 'e5'],
      ['f1', 'e2'],
      ['c8', 'g4'],
      ['g1', 'f3'],
      ['g4', 'f3'],
      ['g2', 'f3'],
    ] as const) {
      match.commit({ from, to })
      expect(match.error()).toBe('')
      match.finishAnimation()
    }
    const saved = loadGummyMatchSession().session!
    expect(saved.captures).toHaveLength(4)
    expect(saved.captures!.slice(0, 2)).toEqual(firstTwo)
    const ids = saved.captures!.map((capture) => capture.mechanic!.id)
    expect(new Set(ids.slice(0, 3)).size).toBe(3)
    expect(ids.slice(0, 3)).toContain('press-settle')
    expect(ids[3]).not.toBe(ids[2])
    const press = saved.captures!.find(
      (capture) => capture.mechanic!.id === 'press-settle',
    )!
    expect(press.motion.shearOnset).toBe(1)
    expect(press.motion.contactHold).toBe(0)
    expect(press.motion.twistAngle).toBeUndefined()
    const { result: replay } = renderHook(useGummyMatch)
    replay.seek(press.ply)
    replay.replay()
    expect(replay.activePresentation()).toEqual(press)
  })

  it('keeps the chosen motion and material through skip, replay, reload and Cinema handoff', () => {
    const match = matchAtCapture()
    const original = structuredClone(match.currentPresentation()!)
    expect(original.mechanic?.version).toBe(1)
    const capture = match.currentMove()!
    const fen = match.position().fen
    match.updateAppearance({
      theme: 'lava',
      scale: 0.95,
      settings: {
        ...match.appearance().settings,
        softness: 0.2,
        palette: 'lagoon',
      },
    })
    match.replay()
    expect(match.activePresentation()).toEqual(original)
    match.finishAnimation()
    expect(match.position().fen).toBe(fen)
    match.replay()
    expect(match.activePresentation()).toEqual(original)
    match.finishAnimation()
    const { result: restored } = renderHook(useGummyMatch)
    expect(restored.appearance().theme).toBe('lava')
    expect(restored.currentPresentation()).toEqual(original)
    const recipe = createGummyMatchCinemaRecipe(
      capture,
      restored.appearance(),
      restored.currentPresentation(),
    )
    expect(recipe.shot.motion).toEqual(original.motion)
    expect(recipe.shot.mechanic).toEqual(original.mechanic)
    expect(recipe.material).toEqual(original.appearance.settings)
    expect(recipe.scale).toBe(original.appearance.scale)
    expect(recipe.shot.boardTheme).toBe(original.appearance.theme)
  })

  it('does not repeat a mechanic on consecutive captures and keeps import choices deterministic', () => {
    const match = matchAtCapture()
    const first = match.currentPresentation()!
    match.seek(4)
    const second = match.currentPresentation()!
    expect(second.mechanic?.id).not.toBe(first.mechanic?.id)
    match.newGame()
    match.importPgn(line)
    match.seek(3)
    expect(match.currentPresentation()).toEqual(first)
    match.seek(4)
    expect(match.currentPresentation()).toEqual(second)
  })

  it('drops future effects on a new branch, and removes the effect when its move is undone', () => {
    const match = matchAtCapture()
    match.seek(2)
    match.commit({ from: 'e4', to: 'd5' })
    const saved = loadGummyMatchSession().session!
    expect(saved.captures).toHaveLength(1)
    expect(saved.captures![0]!.lan).toBe('e4d5')
    expect(match.activePresentation()).toEqual(saved.captures![0])
    match.finishAnimation()
    match.undo()
    expect(match.currentPresentation()).toBeUndefined()
    expect(loadGummyMatchSession().session!.captures).toEqual([])
    expect(match.game().history.map((move) => move.san)).toEqual(['e4', 'd5'])
  })

  it('saves a draw claimed while reviewing before later captures', () => {
    const { result: match } = renderHook(useGummyMatch)
    expect(
      match.importPgn(
        '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. e4 d5 6. exd5 *',
      ),
    ).toBe(true)
    match.seek(8)
    match.claim('threefold-repetition')
    const restored = loadGummyMatchSession()
    expect(restored.error).toBeUndefined()
    expect(restored.session?.game.position.drawReason).toBe(
      'threefold-repetition',
    )
    expect(restored.session?.game.history).toHaveLength(8)
    expect(restored.session?.captures).toEqual([])
    expect(match.notice()).toBe('')
  })

  it('restores version-one matches with their original early-shear motion', () => {
    sessionStorage.setItem(
      GUMMY_MATCH_SESSION_KEY,
      JSON.stringify({ version: 1, pgn: line, cursor: 3 }),
    )
    const { result: match } = renderHook(useGummyMatch)
    expect(match.currentPresentation()?.motion).toEqual(
      GUMMY_BOARD_EARLY_SHEAR_MOTION,
    )
    expect(match.currentPresentation()?.mechanic).toBeUndefined()
    match.persist()
    expect(
      JSON.parse(sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)!).version,
    ).toBe(2)
    expect(loadGummyMatchSession().session?.captures![0]?.motion).toEqual(
      GUMMY_BOARD_EARLY_SHEAR_MOTION,
    )
  })

  it('preserves the game and reports corrupted presentation data instead of applying it to another move', () => {
    const match = matchAtCapture()
    const saved = JSON.parse(sessionStorage.getItem(GUMMY_MATCH_SESSION_KEY)!)
    saved.captures[0].beforeFen = 'wrong position'
    sessionStorage.setItem(GUMMY_MATCH_SESSION_KEY, JSON.stringify(saved))
    const restored = loadGummyMatchSession()
    expect(restored.session?.game.position.fen).toBe(match.game().position.fen)
    expect(restored.error).toContain('saved capture effects were invalid')
    expect(restored.session?.captures![0]?.motion).toEqual(
      GUMMY_BOARD_EARLY_SHEAR_MOTION,
    )
  })
})
