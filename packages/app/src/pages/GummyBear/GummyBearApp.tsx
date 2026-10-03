/** Standalone GPU and studio providers for the isolated gummy bear simulation. */
import { StandalonePage } from '@/components/StandalonePage/StandalonePage'
import { GummyBearPage } from './GummyBearPage'

export function GummyBearApp() {
  return (
    <StandalonePage>
      <GummyBearPage />
    </StandalonePage>
  )
}
