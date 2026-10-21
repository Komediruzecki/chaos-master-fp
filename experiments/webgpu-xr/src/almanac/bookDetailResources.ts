// Almanac-specific source and labels share the retained surface resource lifetime.
import { createSurfaceResources } from '../materials/surfaceResources'
import { BOOK_DETAIL_URL } from './bookDetailData'
import type { TgpuRoot } from 'typegpu'

export { surfaceDetailLayout as bookDetailLayout } from '../materials/surfaceResources'
export type { SurfaceResources as BookDetailResources } from '../materials/surfaceResources'

export function createBookDetailResources(root: TgpuRoot, changed: () => void) {
  return createSurfaceResources(root, changed, {
    url: BOOK_DETAIL_URL,
    label: 'Book',
  })
}
