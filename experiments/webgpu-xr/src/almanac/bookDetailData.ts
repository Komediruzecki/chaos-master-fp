// The Almanac retains its public data contract over the shared linear surface bundle format.
import { parseSurfaceData } from '../materials/surfaceData'

export const BOOK_DETAIL_URL =
  '/models/almanac/surfaces/almanac-surfaces-v1.bin'
export {
  SURFACE_DETAIL_BYTES as BOOK_DETAIL_BYTES,
  SURFACE_DETAIL_GPU_BYTES as BOOK_DETAIL_GPU_BYTES,
  EMPTY_SURFACE_DETAIL as EMPTY_BOOK_DETAIL,
} from '../materials/surfaceData'
export type {
  SurfaceData as BookDetailData,
  SurfaceLevel as BookDetailLevel,
  SurfaceSnapshot as BookDetailSnapshot,
} from '../materials/surfaceData'

export function parseBookDetailData(buffer: ArrayBuffer) {
  return parseSurfaceData(buffer, 'Book')
}
