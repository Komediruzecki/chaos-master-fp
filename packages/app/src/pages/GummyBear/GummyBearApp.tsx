/** Standalone GPU and studio providers for the isolated gummy bear simulation. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { GummyBoardPage } from '../GummyBoard/GummyBoardPage'
import { GummyCinemaPage } from '../GummyBoard/GummyCinemaPage'
import { GummyMatchPage } from '../GummyBoard/GummyMatchPage'
import { GummyBearPage } from './GummyBearPage'

export function GummyBearApp() {
  const board =
    new URLSearchParams(window.location.search).get('view') === 'board'
  const cinema =
    new URLSearchParams(window.location.search).get('view') === 'cinema'
  const match =
    new URLSearchParams(window.location.search).get('view') === 'match'
  return (
    <StandalonePage>
      {match ? (
        <GummyMatchPage />
      ) : cinema ? (
        <GummyCinemaPage />
      ) : board ? (
        <GummyBoardPage />
      ) : (
        <GummyBearPage />
      )}
    </StandalonePage>
  )
}
