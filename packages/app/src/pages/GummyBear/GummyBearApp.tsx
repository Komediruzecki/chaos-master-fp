/** Standalone GPU and studio providers for the isolated gummy bear simulation. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { GummyBoardPage } from '../GummyBoard/GummyBoardPage'
import { GummyBearPage } from './GummyBearPage'

export function GummyBearApp() {
  const board =
    new URLSearchParams(window.location.search).get('view') === 'board'
  return (
    <StandalonePage>
      {board ? <GummyBoardPage /> : <GummyBearPage />}
    </StandalonePage>
  )
}
