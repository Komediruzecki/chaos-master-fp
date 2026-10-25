/** Bake finite material off the UI thread; no GPU device or simulation is created here. */
import { buildCandidateSolid } from '@/simulation/gummy/gummyAffineIfsVolume'
import type { ChessCandidate } from '@/flame/chess/chessCandidate'
import type { CandidateSolid } from '@/simulation/gummy/gummyAffineIfsVolume'

export type CandidateSolidData = Omit<CandidateSolid, 'field'>
export type CandidateSolidReply =
  | { data: CandidateSolidData }
  | { error: string }

globalThis.self.onmessage = (event: MessageEvent<ChessCandidate>) => {
  try {
    const baked = buildCandidateSolid(event.data)
    const { field: _field, ...data } = baked
    globalThis.self.postMessage({ data } satisfies CandidateSolidReply, {
      transfer: [data.restPositions.buffer],
    })
  } catch (error) {
    globalThis.self.postMessage({
      error:
        error instanceof Error ? error.message : 'Could not build this solid.',
    } satisfies CandidateSolidReply)
  }
}
