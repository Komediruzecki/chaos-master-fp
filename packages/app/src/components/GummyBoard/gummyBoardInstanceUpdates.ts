/** One or two deforming candy pieces share the board HDR optics with cached waiting instances. */
import { GUMMY_BOARD_INSTANCE_FLOATS, packGummyBoardInstance, packGummyBoardInstances, } from './gummyBoardInstances'
import { gummyBoardThemeCode } from './gummyBoardThemes'
import type { GummyBoardPiece } from './gummyBoardInstances'
import type { GummyBoardRenderOptions } from './gummyBoardRenderContracts'
import type { GummyBoardRenderResources } from './gummyBoardRenderResources'

export function createGummyBoardInstanceUpdates(
  resources: GummyBoardRenderResources,
) {
  const {
    moulds,
    surface,
    secondarySurface,
    uploadChanged,
    victim,
    secondary,
    batches,
    moving,
    movingDraw,
    movingDrawData,
    movingSource,
    instanceData,
    materials,
    materialData,
    previousMaterials,
    stage,
    stageData,
    previousStage,
  } = resources
  let previousSecondary = false

  function updateSelection(options: GummyBoardRenderOptions) {
    stageData.fill(0)
    const selected = options.pieces.find(
      (piece) => piece.id === options.selectedPieceId,
    )
    const selectedPosition =
      options.selectionPosition ??
      selected?.position ??
      (options.selectedPieceId === options.victimId
        ? options.victimPosition
        : options.selectedPieceId === options.secondary?.id
          ? options.secondary?.position
          : undefined)
    const selectedScale =
      selected?.scale ??
      (options.selectedPieceId === options.victimId
        ? options.victimScale
        : options.secondary?.scale) ??
      1
    if (selectedPosition)
      stageData.set([
        selectedPosition[0],
        selectedPosition[2],
        0.86 * selectedScale,
        1,
      ])
    stageData[4] = gummyBoardThemeCode(options.boardTheme)
    const boardTime = options.boardTime ?? 0
    stageData[5] = Number.isFinite(boardTime) ? Math.max(0, boardTime) : 0
    stageData[6] = options.caustics === false ? 0 : 1
    uploadChanged(stage, stageData, previousStage)
  }

  function updateActiveInstances(options: GummyBoardRenderOptions) {
    if (!surface) return false
    packGummyBoardInstance(
      victim.data,
      0,
      options.victimId,
      options.victimPosition,
      options.victimSide ?? 0,
      options.victimScale,
      options.victimPalette,
    )
    let dynamicChanged = uploadChanged(
      victim.buffer,
      victim.data,
      victim.previous,
    )
    if (options.secondary && secondary) {
      packGummyBoardInstance(
        secondary.data,
        0,
        options.secondary.id,
        options.secondary.position,
        options.secondary.side,
        options.secondary.scale,
        options.secondary.palette,
        options.secondary.rotationY,
      )
      dynamicChanged =
        uploadChanged(secondary.buffer, secondary.data, secondary.previous) ||
        dynamicChanged
    }
    return dynamicChanged
  }

  function updateMovingPiece(movingPiece: GummyBoardPiece | undefined) {
    let dynamicChanged = false
    const movingCount = movingPiece ? 1 : 0
    dynamicChanged ||= movingSource.count !== movingCount
    movingSource.count = movingCount
    if (movingPiece) {
      packGummyBoardInstance(
        moving.data,
        0,
        movingPiece.id,
        movingPiece.position,
        movingPiece.side,
        movingPiece.scale,
        movingPiece.palette,
        movingPiece.rotationY,
      )
      dynamicChanged =
        uploadChanged(moving.buffer, moving.data, moving.previous) ||
        dynamicChanged
      const batch = batches.find(
        (candidate) => candidate.mould === movingPiece.mould,
      )!
      if (
        movingSource.mesh !== batch.source.mesh ||
        movingDrawData[0] !== batch.drawData[0]
      ) {
        movingSource.mesh = batch.source.mesh
        movingDrawData[0] = batch.drawData[0]!
        movingDraw.write(movingDrawData.buffer)
        dynamicChanged = true
      }
    }
    return dynamicChanged
  }

  function updateBatches(ranges: ReturnType<typeof packGummyBoardInstances>) {
    let staticChanged = false
    for (const batch of batches) {
      const range = ranges.get(batch.mould)!
      batch.data.fill(0)
      batch.data.set(
        instanceData.subarray(
          range.start * GUMMY_BOARD_INSTANCE_FLOATS,
          (range.start + range.count) * GUMMY_BOARD_INSTANCE_FLOATS,
        ),
      )
      const changed = uploadChanged(batch.buffer, batch.data, batch.previous)
      if (changed || batch.source.count !== range.count) {
        batch.drawData[1] = range.count
        batch.source.indirect.write(batch.drawData.buffer)
        staticChanged = true
      }
      batch.source.count = range.count
    }
    return staticChanged
  }

  function updateMaterials(
    options: GummyBoardRenderOptions,
    movingPiece: GummyBoardPiece | undefined,
    movingCount: number,
  ) {
    materialData.fill(0)
    const material = (data: Float32Array, offset: number) => {
      const index = (data[offset + 3]! - 1) * 4
      materialData[index] = data[offset + 8]!
      materialData[index + 1] = data[offset + 9]!
      materialData[index + 2] = data[offset + 7]!
    }
    for (let index = 0; index < options.pieces.length - movingCount; index++)
      material(instanceData, index * GUMMY_BOARD_INSTANCE_FLOATS)
    if (surface) material(victim.data, 0)
    if (movingPiece) material(moving.data, 0)
    if (options.secondary && secondary) material(secondary.data, 0)
    if (options.supportingDensity !== undefined) {
      const density = options.supportingDensity
      if (!Number.isFinite(density) || density < 1 || density > 3)
        throw new RangeError(
          'Supporting candy density must be between one and three.',
        )
      for (const piece of options.pieces)
        if (piece.id !== options.movingPieceId)
          materialData[piece.id * 4 + 3] = density
    }
    uploadChanged(materials, materialData, previousMaterials)
  }

  function updateInstances(options: GummyBoardRenderOptions) {
    if (options.pieces.some((piece) => !moulds.includes(piece.mould)))
      throw new Error('The piece mould was not prepared for this renderer')
    if (options.secondary && !secondarySurface)
      throw new Error(
        'A second gummy surface must be supplied when creating the board renderer',
      )
    let ranges = packGummyBoardInstances(
      instanceData,
      options.pieces,
      surface ? options.victimId : undefined,
      options.secondary?.id,
    )
    const movingPiece = options.pieces.find(
      (piece) => piece.id === options.movingPieceId,
    )
    if (movingPiece)
      ranges = packGummyBoardInstances(
        instanceData,
        options.pieces.filter((piece) => piece.id !== options.movingPieceId),
        surface ? options.victimId : undefined,
        options.secondary?.id,
      )
    let dynamicChanged = updateActiveInstances(options)
    dynamicChanged = updateMovingPiece(movingPiece) || dynamicChanged
    const movingCount = movingPiece ? 1 : 0
    const staticChanged = updateBatches(ranges)
    updateMaterials(options, movingPiece, movingCount)
    updateSelection(options)
    dynamicChanged ||= previousSecondary !== Boolean(options.secondary)
    previousSecondary = Boolean(options.secondary)
    return { staticChanged, dynamicChanged }
  }

  return updateInstances
}
