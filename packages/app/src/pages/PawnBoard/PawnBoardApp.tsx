/** Standalone native WebGPU pawn board with the studio's theme and device providers. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { PawnBoardPage } from './PawnBoardPage'

export function PawnBoardApp() {
  return (
    <StandalonePage>
      <PawnBoardPage />
    </StandalonePage>
  )
}
