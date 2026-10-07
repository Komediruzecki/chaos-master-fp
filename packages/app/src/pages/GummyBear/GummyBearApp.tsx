/** Standalone GPU and studio providers for the isolated gummy bear simulation. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { GummyBoardPage } from '../GummyBoard/GummyBoardPage'
import { GummyCinemaPage } from '../GummyBoard/GummyCinemaPage'
import { GummyBearPage } from './GummyBearPage'

export function GummyBearApp() {
  const board =
    new URLSearchParams(window.location.search).get('view') === 'board'
  const cinema =
    new URLSearchParams(window.location.search).get('view') === 'cinema'
  return (
    <StandalonePage>
      {cinema ? (
        <GummyCinemaPage />
      ) : board ? (
        <GummyBoardPage />
      ) : (
        <GummyBearPage />
      )}
    </StandalonePage>
  )
}
