/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { untrack } from 'solid-js'
import { GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_VICTIM_ID, } from './gummyBoardChoreography'
import { pickGummyBoardMould, pickGummyBoardParticles, } from './gummyBoardPicking'
import type { createGummyBoardPieces } from './gummyBoardChoreography'
import type { GummyBoardStudySettings } from './gummyBoardStudyContracts'
import type { createGummyCameraInput } from '@/components/GummyBear/gummyCameraInput'
import type { gummyRay, GummyVec3 } from '@/components/GummyBear/gummyStudyMath'
import type { createGummyParticleSolver } from '@/simulation/gummy/gummyParticleSolver'

type Context = {
  input: ReturnType<typeof createGummyCameraInput>
  solver: ReturnType<typeof createGummyParticleSolver>
  rook: ReturnType<typeof createGummyParticleSolver> | undefined
  pieces: ReturnType<typeof createGummyBoardPieces>
  settings: () => GummyBoardStudySettings
  rayAt: (x: number, y: number) => ReturnType<typeof gummyRay>
  victimOffset: () => GummyVec3
  rookOffset: () => GummyVec3
  disposed(): boolean
  ready(): boolean
  onSelectPiece?: (id: number | undefined) => void
}
export function createGummyBoardStudySelection(context: Context) {
  const {
    input,
    solver,
    rook,
    pieces,
    settings,
    rayAt,
    victimOffset,
    rookOffset,
  } = context
  const props = context
  let selectionRequest = 0

  async function selectAt(x: number, y: number) {
    const token = ++selectionRequest
    const ray = rayAt(x, y)
    const scale = settings().scale
    let id: number | undefined
    let nearest = Infinity
    const consider = (pieceId: number, distance: number | undefined) => {
      if (distance !== undefined && distance < nearest) {
        nearest = distance
        id = pieceId
      }
    }
    for (const piece of pieces)
      consider(piece.id, pickGummyBoardMould(ray, piece, scale))
    try {
      const [pawnPositions, rookPositions] = await Promise.all([
        solver.readPositions(),
        rook?.readPositions(),
      ])
      if (context.disposed() || token !== selectionRequest) return
      consider(
        GUMMY_BOARD_VICTIM_ID,
        pickGummyBoardParticles(
          ray,
          pawnPositions,
          victimOffset(),
          scale,
          solver.spacing,
        ),
      )
      if (rook && rookPositions)
        consider(
          GUMMY_BOARD_ATTACKER_ID,
          pickGummyBoardParticles(
            ray,
            rookPositions,
            rookOffset(),
            scale,
            rook.spacing,
          ),
        )
      untrack(() => props.onSelectPiece?.(id))
    } catch {
      // Color editing must remain available through the piece picker if GPU readback fails.
      if (!context.disposed() && token === selectionRequest)
        untrack(() => props.onSelectPiece?.(id))
    }
  }
  let tap: { id: number; x: number; y: number } | undefined

  function pointerDown(event: PointerEvent) {
    selectionRequest++
    if (tap) tap = undefined
    else if (
      event.isPrimary &&
      event.button === 0 &&
      settings().mode === 'orbit'
    )
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
    input.pointerDown(event)
  }

  function pointerMove(event: PointerEvent) {
    if (
      tap?.id === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
    )
      tap = undefined
    input.pointerMove(event)
  }

  function pointerEnd(event: PointerEvent) {
    const selected =
      tap?.id === event.pointerId && event.type === 'pointerup'
        ? tap
        : undefined
    tap = undefined
    input.pointerEnd(event)
    if (selected && context.ready()) void selectAt(selected.x, selected.y)
  }
  return {
    pointerDown,
    pointerMove,
    pointerEnd,
    invalidate() {
      selectionRequest++
    },
  }
}
