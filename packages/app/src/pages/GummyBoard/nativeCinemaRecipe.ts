/** Portable native capture recipes reconstruct a legal move instead of trusting serialized receipts. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { validateNativeChessCollectionSelection } from './gummyMatchAppearance'
import type { ChessMoveReceipt, ChessPromotion, ChessSquare, } from '@chaos-master/core/chess/chessGame'
import type { NativeChessCollectionSelection } from './gummyMatchAppearance'

export type NativeCinemaRecipe = {
  format: 'native-chess-cinema-shot'
  version: 1
  fen: string
  from: ChessSquare
  to: ChessSquare
  promotion?: ChessPromotion
  nativeCollection: NativeChessCollectionSelection
  scale: number
  quality: 'normal' | 'fine'
  camera: 'arc' | 'diagonal' | 'hero'
}

export function nativeCinemaReason(receipt?: ChessMoveReceipt) {
  if (!receipt) return 'Choose a capture in the move history to make a shot.'
  if (!receipt.captured)
    return 'This move has no capture. Choose a move that takes a piece.'
  return undefined
}

export function resolveNativeCinemaReceipt(recipe: NativeCinemaRecipe) {
  const { receipt } = applyChessMove(createChessGame(recipe.fen), {
    from: recipe.from,
    to: recipe.to,
    ...(recipe.promotion ? { promotion: recipe.promotion } : {}),
  })
  const reason = nativeCinemaReason(receipt)
  if (reason) throw new Error(reason)
  return receipt
}

function parseMove(data: Record<string, unknown>) {
  if (typeof data.fen !== 'string' || data.fen.length > 200)
    throw new Error('Provide a valid chess position in FEN format.')
  for (const key of ['from', 'to'])
    if (typeof data[key] !== 'string' || !/^[a-h][1-8]$/.test(data[key]))
      throw new Error('Choose source and destination squares from a1 to h8.')
  if (
    data.promotion !== undefined &&
    !['queen', 'rook', 'bishop', 'knight'].includes(data.promotion as string)
  )
    throw new Error('Choose a queen, rook, bishop or knight for promotion.')
  return {
    fen: data.fen,
    from: data.from as ChessSquare,
    to: data.to as ChessSquare,
    ...(data.promotion ? { promotion: data.promotion as ChessPromotion } : {}),
  }
}

function parseLook(
  data: Record<string, unknown>,
): Pick<
  NativeCinemaRecipe,
  'nativeCollection' | 'scale' | 'quality' | 'camera'
> {
  const nativeCollection = validateNativeChessCollectionSelection(
    data.nativeCollection,
  )
  if (!nativeCollection)
    throw new Error('Choose a fractal collection for this shot.')
  if (
    typeof data.scale !== 'number' ||
    !Number.isFinite(data.scale) ||
    data.scale < 0.85 ||
    data.scale > 1
  )
    throw new Error('Piece size must be between 85% and 100%.')
  if (data.quality !== 'normal' && data.quality !== 'fine')
    throw new Error('Choose Normal or Fine fractal detail.')
  if (
    data.camera !== 'arc' &&
    data.camera !== 'diagonal' &&
    data.camera !== 'hero'
  )
    throw new Error('Choose an arc, diagonal or hero camera.')
  return {
    nativeCollection,
    scale: data.scale,
    quality: data.quality,
    camera: data.camera,
  }
}

export function parseNativeCinemaRecipe(value: unknown): NativeCinemaRecipe {
  if (typeof value === 'string' && value.length > 30_000)
    throw new Error('The shot recipe is too large.')
  const raw: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Paste a native chess shot recipe object.')
  const data = raw as Record<string, unknown>
  if (data.format !== 'native-chess-cinema-shot' || data.version !== 1)
    throw new Error('Expected a version 1 native chess cinema shot.')
  const recipe: NativeCinemaRecipe = {
    format: 'native-chess-cinema-shot',
    version: 1,
    ...parseMove(data),
    ...parseLook(data),
  }
  resolveNativeCinemaReceipt(recipe)
  return recipe
}

export function createNativeCinemaRecipe(
  receipt: ChessMoveReceipt,
  look: { nativeCollection: NativeChessCollectionSelection; scale: number },
): NativeCinemaRecipe {
  const reason = nativeCinemaReason(receipt)
  if (reason) throw new Error(reason)
  return parseNativeCinemaRecipe({
    format: 'native-chess-cinema-shot',
    version: 1,
    fen: receipt.before.fen,
    from: receipt.from,
    to: receipt.to,
    ...(receipt.promotion ? { promotion: receipt.promotion } : {}),
    nativeCollection: look.nativeCollection,
    scale: look.scale,
    quality: 'normal',
    camera: 'arc',
  })
}
