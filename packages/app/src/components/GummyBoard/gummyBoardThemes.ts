/** Stable live board-material identifiers; themes do not change collision geometry. */
export type GummyBoardTheme = 'classic' | 'glass' | 'lava'
export const GUMMY_BOARD_LIGHT_EXTENT = 7
/** Glass needs an air gap beneath its -0.32 underside to reveal transmitted light. */
export const GUMMY_BOARD_GLASS_FLOOR = -1.05
export const GUMMY_BOARD_RECEIVER_EXTENT = 8
export const GUMMY_BOARD_GLASS_LIGHT_GRID = 96

export function gummyBoardThemeCode(
  theme: GummyBoardTheme = 'classic',
): number {
  switch (theme) {
    case 'classic':
      return 0
    case 'glass':
      return 1
    case 'lava':
      return 2
    default:
      throw new Error('Unknown gummy board theme')
  }
}
