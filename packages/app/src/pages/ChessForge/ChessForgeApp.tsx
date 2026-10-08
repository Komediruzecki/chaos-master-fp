/** Provider boundary keeps candidate inspection independent of the editor. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { ChessForgePage } from './ChessForgePage'

export function ChessForgeApp() {
  return (
    <StandalonePage>
      <ChessForgePage />
    </StandalonePage>
  )
}
