import { createSignal, onMount, Show } from 'solid-js'
import { LANDING_FLAMES } from '../lib/flame'
import FlameStage from './FlameStage'

/**
 * Dev-only island for the `poster-capture` page: renders one landing flame at a
 * high fixed resolution and exposes its live-quality getter on `window` so a
 * headed Playwright script can wait for full convergence, then screenshot the
 * canvas into public/posters/<name>.jpg. Not shipped / linked anywhere.
 *
 * Reads ?name= and ?size= from the URL. Uses the same descriptors the live
 * landing renders (LANDING_FLAMES), so each poster matches its flame exactly.
 */
type CaptureWindow = Window & {
  __captureQuality?: () => number
  __captureError?: string
}

export default function PosterCapture() {
  const [flameName, setFlameName] = createSignal<string>()
  const [size, setSize] = createSignal(1280)

  onMount(() => {
    const params = new URLSearchParams(window.location.search)
    const name = params.get('name') ?? ''
    const s = Number(params.get('size'))
    if (Number.isFinite(s) && s > 0) setSize(s)
    if (!(name in LANDING_FLAMES)) {
      ;(window as CaptureWindow).__captureError = `unknown flame: ${name}`
      return
    }
    setFlameName(name)
  })

  return (
    <Show when={flameName()}>
      {(name) => (
        <div
          style={{
            width: `${size()}px`,
            height: `${size()}px`,
            background: '#000',
          }}
        >
          <FlameStage
            flame={LANDING_FLAMES[name() as keyof typeof LANDING_FLAMES]}
            quality={0.995}
            pointCountPerBatch={256}
            canvasClass="plate-canvas"
            fixedResolution={{ width: size(), height: size() }}
            onQualityGetter={(get) => {
              ;(window as CaptureWindow).__captureQuality = get
            }}
          />
        </div>
      )}
    </Show>
  )
}
