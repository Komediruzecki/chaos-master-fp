/** Standalone provider stack for the first editable fractal chess piece. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { PawnPage } from './PawnPage'

export function PawnApp() {
  return (
    <StandalonePage>
      <PawnPage />
    </StandalonePage>
  )
}
