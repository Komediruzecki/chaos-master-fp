/** Immutable chess positions and move receipts shared by game controls and visual playback. */
export type ChessColor = 'w' | 'b'
export type ChessRole = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'
export type ChessPromotion = 'queen' | 'rook' | 'bishop' | 'knight'
export type ChessSquare =
  `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
export type ChessDrawClaim = 'threefold-repetition' | 'fifty-move'
export type ChessDrawReason =
  | ChessDrawClaim
  | 'insufficient-material'
  | 'fivefold-repetition'
  | 'seventy-five-move'
export type ChessStatus = 'active' | 'checkmate' | 'stalemate' | 'draw'
export type ChessMoveKind =
  | 'move'
  | 'capture'
  | 'en-passant'
  | 'castle'
  | 'promotion'

export type ChessPiece = Readonly<{
  /** Initial square index plus one. Identity survives movement, promotion and undo. */
  id: number
  color: ChessColor
  role: ChessRole
  square: ChessSquare
}>

export type ChessPosition = Readonly<{
  /** All six FEN fields, including the target of a double pawn step. */
  fen: string
  pieces: readonly ChessPiece[]
  turn: ChessColor
  check: boolean
  status: ChessStatus
  winner?: ChessColor
  drawReason?: ChessDrawReason
  drawClaims: readonly ChessDrawClaim[]
  /** Position equivalence includes only legally available en-passant captures. */
  repetitionKey: string
  repetitionCount: number
}>

export type ChessMoveInput = Readonly<{
  from: ChessSquare
  to: ChessSquare
  promotion?: ChessPromotion
}>

export type ChessLegalMove = ChessMoveInput &
  Readonly<{
    pieceId: number
    san: string
    lan: string
    kind: ChessMoveKind
    captureSquare?: ChessSquare
  }>

export type ChessMoveReceipt = ChessLegalMove &
  Readonly<{
    /** One-based move count from the loaded initial position. */
    ply: number
    before: ChessPosition
    after: ChessPosition
    /** Its square is the captured square, including off-destination en passant. */
    captured?: ChessPiece
    secondaryMove?: Readonly<{
      pieceId: number
      from: ChessSquare
      to: ChessSquare
    }>
  }>

export type ChessGame = Readonly<{
  initialFen: string
  position: ChessPosition
  history: readonly ChessMoveReceipt[]
  claimedDraw?: ChessDrawClaim
}>

export type ChessPgnImport = Readonly<{
  game: ChessGame
  headers: Readonly<Record<string, string>>
}>
