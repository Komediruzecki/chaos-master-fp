/**
 * The atlas's spatial stage: camera travel reveals depth between five fixed
 * flame worlds. Only the selected world mounts WebGPU; stars and orbit paths
 * share its 3D projection in one lightweight, demand-rendered Canvas2D layer.
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack, } from 'solid-js'
import { atlasProjector, atlasWorld, cameraForWorld, interpolateCamera, orbitPoint, TRAVEL_DURATION_MS, } from './atlasCamera'
import { FlameOrb } from './FlameOrb'
import ui from './ImmersiveAtlas.module.css'
import { ORB_PRESETS } from './orbPresets'
import type { AtlasCamera, AtlasPoint, AtlasViewport } from './atlasCamera'
import type { OrbPreset } from './orbPresets'

export interface ImmersiveAtlasProps {
  preset: OrbPreset
  posters: Record<string, string>
  paused: boolean
  reducedMotion: boolean
  isolated: boolean
  resetKey: number
  zoomStep: number
  ready: boolean
  error?: string
  onSelect: (orb: OrbPreset) => void
  onReady: () => void
  onError: (message: string) => void
  onTravelChange?: (traveling: boolean) => void
}

interface Star {
  position: AtlasPoint
  brightness: number
  size: number
  warm: boolean
}
interface Flight {
  from: AtlasCamera
  to: AtlasCamera
  elapsed: number
}

function createStars(): readonly Star[] {
  let seed = 73291
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  return Array.from({ length: 1300 }, () => {
    const longitude = random() * Math.PI * 2
    const vertical = random() * 2 - 1
    const radial = Math.sqrt(1 - vertical * vertical)
    const depth = 19 + random() ** 0.6 * 85
    return {
      position: [
        Math.cos(longitude) * radial * depth,
        vertical * depth,
        Math.sin(longitude) * radial * depth,
      ] as AtlasPoint,
      brightness: 0.2 + random() * 0.7,
      size: 0.45 + random() ** 5 * 1.45,
      warm: random() > 0.88,
    }
  })
}

function drawSpace(
  context: CanvasRenderingContext2D,
  viewport: AtlasViewport,
  camera: AtlasCamera,
  stars: readonly Star[],
  previous: AtlasCamera | undefined,
  isolated: boolean,
) {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
  const canvas = context.canvas
  const width = Math.round(viewport.width * ratio)
  const height = Math.round(viewport.height * ratio)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, viewport.width, viewport.height)
  const project = atlasProjector(camera, viewport)
  const before = previous && atlasProjector(previous, viewport)

  if (!isolated) {
    for (const [radius, tilt, warp] of [
      [9, -0.287, 0.76],
      [14, 0.3, 0],
      [20, -0.12, 0],
    ]) {
      context.beginPath()
      let connected = false
      for (let index = 0; index <= 200; index++) {
        const point = project(
          orbitPoint((index / 200) * Math.PI * 2, radius, tilt, warp),
        )
        if (point.depth <= 0.15) {
          connected = false
          continue
        }
        if (connected) context.lineTo(point.x, point.y)
        else context.moveTo(point.x, point.y)
        connected = true
      }
      context.strokeStyle =
        radius === 9
          ? 'rgba(169, 200, 214, 0.17)'
          : 'rgba(145, 169, 196, 0.085)'
      context.lineWidth = 0.7
      context.stroke()
    }
  }

  for (const star of stars) {
    const point = project(star.position)
    if (!point.visible) continue
    const opacity = star.brightness * (isolated ? 0.35 : 1)
    context.fillStyle = star.warm
      ? `rgba(234, 206, 174, ${opacity})`
      : `rgba(205, 225, 248, ${opacity})`
    const old = before?.(star.position)
    if (old?.visible) {
      const dx = point.x - old.x
      const dy = point.y - old.y
      const length = Math.hypot(dx, dy)
      if (length > 0.8) {
        const scale = Math.min(1, 18 / length)
        context.beginPath()
        context.moveTo(point.x - dx * scale, point.y - dy * scale)
        context.lineTo(point.x, point.y)
        context.strokeStyle = `rgba(174, 207, 243, ${opacity * 0.45})`
        context.lineWidth = star.size * 0.7
        context.stroke()
      }
    }
    context.beginPath()
    context.arc(point.x, point.y, star.size, 0, Math.PI * 2)
    context.fill()
  }
}

export function ImmersiveAtlas(props: ImmersiveAtlasProps) {
  const [viewport, setViewport] = createSignal<AtlasViewport>({
    width: window.innerWidth,
    height: window.innerHeight,
  })
  const [camera, setCamera] = createSignal(
    cameraForWorld(atlasWorld(props.preset.id), viewport()),
  )
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden)
  const [mounted, setMounted] = createSignal(false)
  const [traveling, setTraveling] = createSignal(false)
  // Shader construction can take longer than a flight. Defer it until arrival;
  // the matching captured world carries the transition without blocking frames.
  const [livePreset, setLivePreset] = createSignal<OrbPreset>()
  const [liveReady, setLiveReady] = createSignal(false)
  const project = createMemo(() => atlasProjector(camera(), viewport()))
  const selected = createMemo(() =>
    project()(atlasWorld(props.preset.id).position),
  )
  const selectedDiameter = createMemo(
    () => 2 * atlasWorld(props.preset.id).radius * selected().scale,
  )
  const flamePaused = createMemo(() => props.paused || !documentVisible())
  const stars = createStars()
  let stage!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  let context: CanvasRenderingContext2D | null = null
  let flight: Flight | undefined
  let frame: number | undefined
  let previousFrame = 0
  let previousCamera: AtlasCamera | undefined

  function reportTravel(value: boolean) {
    if (untrack(traveling) === value) return
    setTraveling(value)
    props.onTravelChange?.(value)
  }

  function cancelFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    previousFrame = 0
    previousCamera = undefined
    reportTravel(false)
  }

  function tick(time: number) {
    frame = undefined
    if (!flight || props.paused || props.reducedMotion || !documentVisible())
      return
    flight.elapsed += Math.max(0, time - previousFrame)
    previousFrame = time
    const progress = Math.min(1, flight.elapsed / TRAVEL_DURATION_MS)
    setCamera(interpolateCamera(flight.from, flight.to, progress))
    if (progress < 1) frame = requestAnimationFrame(tick)
    else {
      flight = undefined
      reportTravel(false)
      setLivePreset(props.preset)
    }
  }

  function resumeFlight() {
    if (
      !flight ||
      frame !== undefined ||
      props.paused ||
      props.reducedMotion ||
      !documentVisible()
    )
      return
    previousFrame = window.performance.now()
    reportTravel(true)
    frame = requestAnimationFrame(tick)
  }

  createEffect(
    on(
      () => ({ id: props.preset.id, size: viewport(), reset: props.resetKey }),
      ({ id, size }, before) => {
        const destination = cameraForWorld(atlasWorld(id), size)
        const sameWorld = before?.id === id
        cancelFrame()
        // Resize/reset changes framing, not renderer ownership. Its ready
        // callback fires once, so preserve both the canvas and its readiness.
        if (!sameWorld) {
          setLiveReady(false)
          setLivePreset(undefined)
        }
        if (
          !before ||
          props.reducedMotion ||
          props.paused ||
          !documentVisible() ||
          sameWorld
        ) {
          flight = undefined
          setCamera(destination)
          if (!props.paused && documentVisible()) setLivePreset(props.preset)
          return
        }
        flight = { from: untrack(camera), to: destination, elapsed: 0 }
        resumeFlight()
      },
    ),
  )

  createEffect(() => {
    const reduced = props.reducedMotion
    const paused = props.paused
    const visible = documentVisible()
    if (reduced && flight) {
      const destination = flight.to
      flight = undefined
      cancelFrame()
      setCamera(destination)
      if (!paused && visible) setLivePreset(untrack(() => props.preset))
    } else if (paused || !visible) cancelFrame()
    else if (flight) resumeFlight()
    else setLivePreset(untrack(() => props.preset))
  })

  createEffect(() => {
    const view = camera()
    const size = viewport()
    const isolated = props.isolated
    const moving = traveling()
    if (!mounted() || !context) return
    drawSpace(
      context,
      size,
      view,
      stars,
      moving ? previousCamera : undefined,
      isolated,
    )
    previousCamera = view
  })

  onMount(() => {
    context = canvas.getContext('2d')
    const measure = () => {
      const bounds = stage.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      setViewport((value) =>
        value.width === width && value.height === height
          ? value
          : { width, height },
      )
    }
    const visibility = () => setDocumentVisible(!document.hidden)
    const resize =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure)
    resize?.observe(stage)
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', visibility)
    measure()
    setMounted(true)
    onCleanup(() => {
      resize?.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', visibility)
    })
  })
  onCleanup(cancelFrame)

  return (
    <div
      ref={stage}
      class={ui.scene}
      data-traveling={traveling()}
      aria-label="Fractal universe"
    >
      <canvas ref={canvas} class={ui.space} aria-hidden="true" />
      <For each={ORB_PRESETS}>
        {(orb) => {
          const world = atlasWorld(orb.id)
          const projected = createMemo(() => project()(world.position))
          const diameter = createMemo(() =>
            Math.max(44, 2 * world.radius * projected().scale),
          )
          const shown = createMemo(() => {
            const point = projected()
            const radius = diameter() / 2
            return (
              !props.isolated &&
              props.preset.id !== orb.id &&
              point.visible &&
              point.y - radius > 72 &&
              point.y + radius < viewport().height - 150
            )
          })
          return (
            <div
              class={ui.world}
              style={{
                transform: `translate3d(${projected().x}px, ${projected().y}px, 0)`,
                'z-index': Math.max(
                  1,
                  500 - Math.round(projected().depth * 10),
                ),
                visibility: shown() ? 'visible' : 'hidden',
              }}
              aria-hidden={!shown()}
            >
              <button
                class={ui.posterButton}
                style={{
                  '--world-scale': diameter() / 100,
                  '--world-accent': orb.accent,
                }}
                type="button"
                aria-label={`Inspect ${orb.name}`}
                tabIndex={shown() ? 0 : -1}
                onClick={() => {
                  props.onSelect(orb)
                }}
              >
                <img src={props.posters[orb.id]} alt="" draggable={false} />
              </button>
              <span
                class={ui.label}
                style={{
                  transform: `translate(-50%, ${diameter() / 2 + 10}px)`,
                }}
              >
                {orb.name}
              </span>
            </div>
          )
        }}
      </For>
      <div
        class={ui.selected}
        style={{
          transform: `translate3d(${selected().x}px, ${selected().y}px, 0)`,
          'z-index': Math.max(1, 500 - Math.round(selected().depth * 10)),
        }}
        role="group"
        aria-label={`Selected world: ${props.preset.name}`}
      >
        <div
          class={ui.liveFrame}
          style={{
            transform: `translate(-50%, -50%) scale(${selectedDiameter() / (640 * 0.67)})`,
          }}
        >
          <img
            class={ui.readyPoster}
            style={{
              visibility:
                props.ready && liveReady() && livePreset() && !props.error
                  ? 'hidden'
                  : 'visible',
            }}
            src={props.posters[props.preset.id]}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <Show when={!props.error}>
            <Show when={livePreset()} keyed>
              {(preset) => {
                let active = true
                onCleanup(() => {
                  active = false
                })
                return (
                  <FlameOrb
                    class={ui.liveOrb}
                    preset={preset}
                    paused={flamePaused()}
                    resetKey={props.resetKey}
                    zoomStep={props.zoomStep}
                    onReady={() => {
                      if (active && props.preset.id === preset.id) {
                        setLiveReady(true)
                        props.onReady()
                      }
                    }}
                    onError={(message) => {
                      if (active && props.preset.id === preset.id)
                        props.onError(message)
                    }}
                  />
                )
              }}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
