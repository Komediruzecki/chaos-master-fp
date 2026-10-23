/** A repeatable gummy capture with two-body contact and a preserved driven-rook comparison. */
import { getGummyBoardPiecePalette, GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_VICTIM_ID, GUMMY_BOARD_VICTIM_POSITION, gummyBoardRookPose, } from './gummyBoardChoreography'
import { gummyBoardWorldPoint } from './gummyBoardPicking'
import type { createGummyStudyInput } from '../GummyBear/gummyStudyInput'
import type { createGummyBoardPieces, GummyBoardPhase, } from './gummyBoardChoreography'
import type { createGummyBoardRenderer } from './gummyBoardRenderer'
import type { GummyBoardStudySettings, NativeGummyBoardProps, } from './gummyBoardStudyContracts'
import type { createGummyPointerRenderer } from '@/components/GummyBear/gummyPointerRenderer'
import type { GummyDragFrame, GummyGrip, GummyVec3, } from '@/components/GummyBear/gummyStudyMath'

type Pieces = ReturnType<typeof createGummyBoardPieces>
type Context = {
  props: NativeGummyBoardProps
  pieces: Pieces
  attacker: Pieces[number] | undefined
  attackerHome: Pieces[number]
  victimHome: Pieces[number]
  rook: unknown
  canvas: HTMLCanvasElement
  vp: Float32Array
  inverse: Float32Array
  eye: Float32Array
  pointerRenderer: ReturnType<typeof createGummyPointerRenderer>
  input: ReturnType<typeof createGummyStudyInput>['input']
  settings: () => GummyBoardStudySettings
  camera: () => { width: number; height: number }
  victimOffset: () => GummyVec3
  rookOffset: () => GummyVec3
  state(): {
    renderer: Awaited<ReturnType<typeof createGummyBoardRenderer>> | undefined
    crashTime: number
    impact: number
    staged: boolean
    revision: number
    phase: GummyBoardPhase
    ticks: number
    grip: GummyGrip | undefined
    dragFrame: GummyDragFrame | undefined
  }
  didDraw(): void
}

export function createGummyBoardStudyDraw(context: Context) {
  const {
    props,
    pieces,
    attacker,
    attackerHome,
    victimHome,
    rook,
    canvas,
    vp,
    inverse,
    eye,
    pointerRenderer,
    input,
    settings,
    camera,
    victimOffset,
    rookOffset,
  } = context
  return function draw() {
    const {
      renderer,
      crashTime,
      impact,
      staged,
      revision,
      phase,
      ticks,
      grip,
      dragFrame,
    } = context.state()
    if (!renderer) return
    const size = camera()
    if (size.width < 1 || size.height < 1) return
    const pose = gummyBoardRookPose(crashTime, impact)
    if (attacker)
      attacker.position = staged
        ? gummyBoardWorldPoint(
            pose.position,
            GUMMY_BOARD_VICTIM_POSITION,
            settings().scale,
          )
        : [...attackerHome.position]
    const renderedPieces = pieces.map((piece) => ({
      ...piece,
      scale: settings().scale,
      palette: getGummyBoardPiecePalette(
        piece,
        settings().material.palette,
        settings().palettes,
      ),
    }))
    renderer.render(
      {
        width: size.width,
        height: size.height,
        viewProjection: vp,
        inverseViewProjection: inverse,
        eye,
        palette: settings().material.palette,
        floor: 'chess',
      },
      {
        revision,
        caustics: settings().material.caustics,
        pieces: renderedPieces,
        movingPieceId: rook ? undefined : GUMMY_BOARD_ATTACKER_ID,
        selectedPieceId: settings().selected,
        selectionPosition:
          settings().selected === GUMMY_BOARD_ATTACKER_ID
            ? staged
              ? gummyBoardWorldPoint(
                  pose.position,
                  GUMMY_BOARD_VICTIM_POSITION,
                  settings().scale,
                )
              : attackerHome.position
            : undefined,
        victimScale: settings().scale,
        victimPalette: getGummyBoardPiecePalette(
          victimHome,
          settings().material.palette,
          settings().palettes,
        ),
        victimId: GUMMY_BOARD_VICTIM_ID,
        victimSide: 1,
        victimPosition: victimOffset(),
        secondary: rook
          ? {
              id: GUMMY_BOARD_ATTACKER_ID,
              position: rookOffset(),
              scale: settings().scale,
              palette: getGummyBoardPiecePalette(
                attackerHome,
                settings().material.palette,
                settings().palettes,
              ),
              side: 0,
              revision,
            }
          : undefined,
      },
    )
    const worldGrip = grip
      ? {
          ...grip,
          target: gummyBoardWorldPoint(
            grip.target,
            victimOffset(),
            settings().scale,
          ),
        }
      : undefined
    pointerRenderer.render({
      ...size,
      viewProjection: vp,
      pointer: input.guide(worldGrip, dragFrame?.point),
    })
    canvas.dataset.testid = 'gummy-board-canvas'
    canvas.dataset.phase = phase
    canvas.dataset.tick = String(ticks)
    canvas.dataset.crashTime = crashTime.toFixed(4)
    canvas.dataset.grip = String(!!grip)
    canvas.dataset.pieces = '32'
    canvas.dataset.layout = staged ? 'capture' : 'opening'
    canvas.dataset.quality = props.renderQuality.name
    canvas.dataset.selectedPiece = String(settings().selected ?? '')
    context.didDraw()
  }
}
