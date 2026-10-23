/** Inspect the exact resting chess mesh and candy optics without allocating a particle solver. */
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, untrack, } from 'solid-js'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { useCanvas } from '@/lib/CanvasContext'
import { useLiveRootContext } from '@/lib/RootContext'
import { bindGummyTouchSurface, createGummyCameraInput, } from '../GummyBear/gummyCameraInput'
import { bindGummyGpuErrors } from '../GummyBear/gummyGpuErrors'
import { gummyCameraMatrices, gummyCameraRadius, } from '../GummyBear/gummyStudyMath'
import { resolveGummyBoardQuality } from '../GummyBoard/gummyBoardQuality'
import { createGummyBoardRenderer } from '../GummyBoard/gummyBoardRenderer'
import ui from './PawnStage.module.css'
import { restPieceFarPlane } from './restPieceCamera'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { GummyCameraFraming, GummyOrbit, } from '../GummyBear/gummyStudyMath'
import type { GummyBoardPiece } from '../GummyBoard/gummyBoardInstances'
import type { GummyBoardMeshQuality } from '../GummyBoard/gummyBoardMeshPreparation'
import type { GummyBoardQuality } from '../GummyBoard/gummyBoardQuality'
import type { GummyBoardRenderer } from '../GummyBoard/gummyBoardRenderer'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

export type RestPieceStatus = {
  ready: boolean
  message?: string
  vertexCount?: number
}

export type RestPieceScene = {
  key: string
  meshes: Pick<
    GummyBoardMeshQuality,
    'artStyle' | 'authoredPawn' | 'restSpacing' | 'moulds' | 'restSources'
  >
  pieces: readonly GummyBoardPiece[]
  framing: GummyCameraFraming
  inspectedMould: GummyChessMould
}
export type RestPieceStageProps = {
  scene: RestPieceScene
  ariaLabel: string
  testId: string
  palette?: GummyPalette
  quality?: GummyBoardQuality
  resetKey?: number
  onStatus?: (status: RestPieceStatus) => void
}

const initialOrbit = (): GummyOrbit => ({ theta: 0.32, phi: 1.15, zoom: 1 })

export function RestPieceStage(props: RestPieceStageProps) {
  const descriptionId = createUniqueId()
  const [visible, setVisible] = createSignal(true)
  return (
    <div class={ui.stage} data-testid={props.testId}>
      <p id={descriptionId} class={ui.description}>
        Drag to orbit. Scroll or pinch to zoom. Use two fingers or Shift and
        drag to pan. Arrow keys rotate, and Home resets the view.
      </p>
      <AutoCanvas
        class={ui.canvas}
        pixelRatio={1}
        onVisibilityChange={setVisible}
        role="img"
        ariaLabel={props.ariaLabel}
        ariaDescribedby={descriptionId}
      >
        <RestPieceCanvas {...props} visible={visible()} />
      </AutoCanvas>
    </div>
  )
}

function RestPieceCanvas(props: RestPieceStageProps & { visible: boolean }) {
  const { root, device } = useLiveRootContext()
  const { canvas, context, canvasFormat, canvasSize } = useCanvas()
  const orbit = initialOrbit()
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse), (max-width: 900px)')
      : undefined
  const [compact, setCompact] = createSignal(media?.matches ?? false)
  const updateCompact = () => setCompact(media?.matches ?? false)
  media?.addEventListener('change', updateCompact)
  onCleanup(() => media?.removeEventListener('change', updateCompact))
  const quality = createMemo(() =>
    resolveGummyBoardQuality(props.quality ?? 'auto', compact()),
  )
  const geometry = createMemo(() => `${props.scene.key}:${quality().name}`)
  let renderer: GummyBoardRenderer | undefined
  let disposed = false,
    failed = false,
    building = false,
    pending = false
  let ready = false,
    sequence = 0,
    rendererSequence = -1,
    raf = 0,
    previousView = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let preparation: AbortController | undefined
  type Request = {
    scene: RestPieceScene
    quality: ReturnType<typeof resolveGummyBoardQuality>
    sequence: number
  }
  let requested: Request | undefined
  const vp = new Float32Array(16),
    inverse = new Float32Array(16),
    eye = new Float32Array(3)
  const report = (status: RestPieceStatus) =>
    untrack(() => props.onStatus?.(status))
  const fail = (message: string) => {
    if (disposed || failed) return
    failed = true
    report({ ready: false, message })
  }
  let releaseErrors = bindGummyGpuErrors(device, fail)

  /** Edits wait for the prior bake to release its density grid before starting the next. */
  async function prepareLatest() {
    if (building || !requested || disposed) return
    const request = requested
    requested = undefined
    building = true
    renderer?.destroy()
    renderer = undefined
    previousView = ''
    const controller = new AbortController()
    preparation = controller
    try {
      await device.queue.onSubmittedWorkDone()
      if (disposed || request.sequence !== sequence) return
      // Each retry owns a fresh error latch after the previous GPU work finishes.
      releaseErrors()
      releaseErrors = bindGummyGpuErrors(device, fail)
      failed = false
      const created = await createGummyBoardRenderer(
        root,
        device,
        context,
        canvasFormat,
        undefined,
        undefined,
        {
          lightResolution: request.quality.lightResolution,
          ...request.scene.meshes,
          signal: controller.signal,
        },
      )
      if (
        disposed ||
        controller.signal.aborted ||
        request.sequence !== sequence
      )
        created.destroy()
      else {
        renderer = created
        rendererSequence = request.sequence
      }
    } catch (error) {
      if (
        !disposed &&
        !controller.signal.aborted &&
        request.sequence === sequence
      )
        fail(
          error instanceof Error
            ? error.message
            : 'The solid preview could not load.',
        )
    } finally {
      building = false
      if (preparation === controller) preparation = undefined
      if (requested && !disposed) void prepareLatest()
    }
  }

  createEffect(
    on(geometry, () => {
      const next = {
        scene: props.scene,
        quality: quality(),
        sequence: ++sequence,
      }
      preparation?.abort()
      requested = undefined
      clearTimeout(timer)
      ready = false
      report({ ready: false, message: 'Updating solid surface…' })
      timer = setTimeout(() => {
        requested = next
        void prepareLatest()
      }, 240)
    }),
  )
  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'orbit',
    ready: () => !!renderer && !failed,
    cameraRadius: () =>
      gummyCameraRadius(
        orbit,
        canvasSize().width / Math.max(1, canvasSize().height),
        'pull',
        props.scene.framing,
      ),
    cancelGrip() {},
    pick() {},
    moveGrip() {},
  })
  createEffect(
    on(
      () => props.resetKey,
      () => {
        input.cancel()
        Object.assign(orbit, initialOrbit(), { pan: undefined })
      },
      { defer: true },
    ),
  )

  function key(event: KeyboardEvent) {
    if (input.cameraKey(event)) event.preventDefault()
    else if (event.key === 'Home') {
      input.cancel()
      Object.assign(orbit, initialOrbit(), { pan: undefined })
      event.preventDefault()
    }
  }

  function frame() {
    if (disposed) return
    if (
      renderer &&
      rendererSequence === sequence &&
      !failed &&
      !pending &&
      props.visible &&
      document.visibilityState !== 'hidden'
    ) {
      const size = canvasSize()
      const palette = props.palette ?? 'marble'
      const pieces = props.scene.pieces
      const viewKey = JSON.stringify([orbit, size, palette, pieces])
      if (size.width > 0 && size.height > 0 && viewKey !== previousView) {
        try {
          gummyCameraMatrices(
            orbit,
            size.width / size.height,
            vp,
            inverse,
            eye,
            'pull',
            props.scene.framing,
            restPieceFarPlane(
              orbit,
              size.width / size.height,
              props.scene.framing,
            ),
          )
          const current = renderer
          current.render(
            {
              ...size,
              viewProjection: vp,
              inverseViewProjection: inverse,
              eye,
              palette,
              floor: 'chess',
            },
            {
              pieces,
              victimId: 0,
              victimPosition: [0, 0, 0],
              revision: 0,
              boardTheme: 'classic',
              caustics: true,
            },
          )
          previousView = viewKey
          pending = true
          const renderedSequence = sequence
          void device.queue
            .onSubmittedWorkDone()
            .then(() => {
              pending = false
              if (
                !disposed &&
                renderer === current &&
                renderedSequence === sequence &&
                rendererSequence === sequence &&
                !failed &&
                !ready
              ) {
                ready = true
                const vertexCount =
                  current.readRenderStats().restVertexCounts[
                    props.scene.inspectedMould
                  ]
                canvas.dataset.vertices = String(vertexCount ?? 0)
                report({ ready: true, vertexCount })
              }
            })
            .catch((error: unknown) => {
              pending = false
              if (renderer === current && renderedSequence === sequence)
                fail(
                  error instanceof Error
                    ? error.message
                    : 'The solid preview could not render.',
                )
            })
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : 'The solid preview could not render.',
          )
        }
      }
    }
    raf = requestAnimationFrame(frame)
  }
  canvas.tabIndex = 0
  const releaseTouch = bindGummyTouchSurface(canvas)
  canvas.addEventListener('pointerdown', input.pointerDown)
  canvas.addEventListener('pointermove', input.pointerMove)
  canvas.addEventListener('pointerup', input.pointerEnd)
  canvas.addEventListener('pointercancel', input.pointerEnd)
  canvas.addEventListener('lostpointercapture', input.pointerEnd)
  canvas.addEventListener('pointerleave', input.pointerLeave)
  canvas.addEventListener('wheel', input.wheel, { passive: false })
  canvas.addEventListener('contextmenu', input.contextMenu)
  canvas.addEventListener('keydown', key)
  raf = requestAnimationFrame(frame)
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
    preparation?.abort()
    cancelAnimationFrame(raf)
    input.cancel()
    releaseTouch()
    releaseErrors()
    renderer?.destroy()
    context.unconfigure()
    canvas.removeEventListener('pointerdown', input.pointerDown)
    canvas.removeEventListener('pointermove', input.pointerMove)
    canvas.removeEventListener('pointerup', input.pointerEnd)
    canvas.removeEventListener('pointercancel', input.pointerEnd)
    canvas.removeEventListener('lostpointercapture', input.pointerEnd)
    canvas.removeEventListener('pointerleave', input.pointerLeave)
    canvas.removeEventListener('wheel', input.wheel)
    canvas.removeEventListener('contextmenu', input.contextMenu)
    canvas.removeEventListener('keydown', key)
  })
  return null
}
