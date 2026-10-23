/** Provider boundary for a complete collection preview independent of any editor or match. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { ChessCollectionsPage } from './ChessCollectionsPage'

export function ChessCollectionsApp() {
  return (
    <StandalonePage>
      <ChessCollectionsPage />
    </StandalonePage>
  )
}
