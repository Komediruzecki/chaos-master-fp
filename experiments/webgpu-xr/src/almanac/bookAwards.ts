// Raised page details are a read-only view of earned encounter identities.
import type { JourneyProgress } from '../journey/progress'

export interface BookAwards {
  glasswake: boolean
  tideweave: boolean
}

export const EMPTY_BOOK_AWARDS: BookAwards = {
  glasswake: false,
  tideweave: false,
}

export const BOOK_RELIEFS = [
  { id: 'glasswake', url: '/models/almanac/glasswake-earned.glb' },
  { id: 'tideweave', url: '/models/almanac/tideweave-earned.glb' },
] as const

/** The relief depicts the version-one encounter, not the longer world motif. */
export function earnedBookAwards(progress: JourneyProgress): BookAwards {
  const glass = progress.worlds.glasswake.completion?.activity
  const tide = progress.worlds.tideweave.completion?.activity
  return {
    glasswake: glass?.id === 'glasswake-seals' && glass.version === 1,
    tideweave: tide?.id === 'tideweave-trace' && tide.version === 1,
  }
}
