/** Adapts the study's one- or two-body solver to board surface reconstruction resources. */
import { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { TgpuRoot } from 'typegpu'
import type { resolveGummyBoardQuality } from './gummyBoardQuality'
import type { createGummyBoardSimulation } from './gummyBoardSimulation'

export function createGummyBoardStudyRenderer(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  canvasFormat: GPUTextureFormat,
  simulation: ReturnType<typeof createGummyBoardSimulation>,
  quality: ReturnType<typeof resolveGummyBoardQuality>,
) {
  const solver = simulation.pawn
  const rook = simulation.rook
  return createGummyBoardRenderer(
    root,
    device,
    context,
    canvasFormat,
    {
      positions: solver.positions,
      restPositions: solver.restPositions,
      particleCount: solver.particleCount,
      spacing: solver.spacing,
      gridBounds: solver.gridBounds,
      cellSize: rook ? solver.spacing : quality.cellSize,
    },
    rook
      ? {
          positions: rook.positions,
          restPositions: rook.restPositions,
          particleCount: rook.particleCount,
          spacing: rook.spacing,
          gridBounds: rook.gridBounds,
          cellSize: rook.spacing,
        }
      : undefined,
    { lightResolution: quality.lightResolution },
  )
}
