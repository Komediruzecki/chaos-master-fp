// Solid owns the browser overlay; IWSDK owns the immersive scene and frame loop.
import { Color, World } from '@iwsdk/core'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import projectOptions from 'virtual:iwsdk-project'
import { snapshot } from './diagnostics'
import { experience, FlameSystem } from './flame-system'

export function App() {
  let container!: HTMLDivElement
  let world: World | undefined
  let disposed = false
  let interval = 0
  let launchTimer = 0
  const [ready, setReady] = createSignal(false)
  const [supported, setSupported] = createSignal(false)
  const [immersive, setImmersive] = createSignal(false)
  const [pending, setPending] = createSignal(false)
  const [running, setRunning] = createSignal(true)
  const [selected, setSelected] = createSignal(false)
  const [emulated, setEmulated] = createSignal(false)
  const [error, setError] = createSignal('')

  const entered = () => {
    setImmersive(true)
    setPending(false)
    setError('')
    window.clearTimeout(launchTimer)
  }
  const exited = () => {
    setImmersive(false)
    setPending(false)
  }
  const contextLost = (event: Event) => {
    event.preventDefault()
    experience.running = false
    experience.ready = false
    setReady(false)
    setError('The graphics context was lost. Reload to restore the flame.')
  }

  function disposeWorld(target: World) {
    const session = target.renderer.xr.getSession()
    if (session) void session.end().catch(() => {})
    target.renderer.xr.removeEventListener('sessionstart', entered)
    target.renderer.xr.removeEventListener('sessionend', exited)
    target.renderer.domElement.removeEventListener(
      'webglcontextlost',
      contextLost,
    )
    target.destroy()
    target.renderer.dispose()
    target.renderer.forceContextLoss()
    target.renderer.domElement.remove()
  }

  onMount(() => {
    Object.assign(experience, {
      running: true,
      selected: false,
      selections: 0,
      elapsed: 0,
      ready: false,
    })
    void World.create(container, projectOptions)
      .then(async (created) => {
        if (disposed) {
          disposeWorld(created)
          return
        }
        world = created
        world.scene.background = new Color(0x02060b)
        world.registerSystem(FlameSystem)
        world.renderer.xr.addEventListener('sessionstart', entered)
        world.renderer.xr.addEventListener('sessionend', exited)
        world.renderer.domElement.addEventListener(
          'webglcontextlost',
          contextLost,
        )
        setEmulated(window.__IWSDK_EMULATION_PROFILE?.active ?? false)
        if (import.meta.env.DEV && window.IWER_DEVICE) {
          // DevUI starts in monoscopic mode with ipd=0; viewports alone are not stereo.
          // This changes only IWER. A physical headset supplies its own eye poses.
          window.IWER_DEVICE.stereoEnabled = true
          window.IWER_DEVICE.ipd = 0.063
        }
        if (import.meta.env.DEV)
          window.__lumenStereo = { world, snapshot: () => snapshot(created) }
        setSupported(
          (await window.navigator.xr?.isSessionSupported('immersive-vr')) ??
            false,
        )
        if (disposed) return
        interval = window.setInterval(() => {
          setReady(experience.ready)
          setSelected(experience.selected)
          setRunning(experience.running)
          if (
            pending() &&
            !created.sessionRequestPending &&
            !created.renderer.xr.isPresenting
          ) {
            setPending(false)
            window.clearTimeout(launchTimer)
            setError(
              'VR did not start. Check headset permissions and try again.',
            )
          }
        }, 250)
      })
      .catch((reason: unknown) => setError(String(reason)))
  })

  onCleanup(() => {
    disposed = true
    window.clearInterval(interval)
    window.clearTimeout(launchTimer)
    if (world) disposeWorld(world)
    delete window.__lumenStereo
  })

  function enterVR() {
    if (!world || pending()) return
    window.clearTimeout(launchTimer)
    setError('')
    setPending(true)
    try {
      world.launchXR()
    } catch (reason) {
      setError(String(reason))
      setPending(false)
    }
    launchTimer = window.setTimeout(() => {
      if (!world?.renderer.xr.isPresenting) {
        setPending(false)
        setError(
          'Waiting for the headset. Finish its permission prompt, then retry if needed.',
        )
      }
    }, 15000)
  }

  async function exitVR() {
    try {
      await world?.renderer.xr.getSession()?.end()
    } catch (reason) {
      setError(String(reason))
    }
  }

  return (
    <main>
      <div
        ref={container}
        class="scene"
        aria-label="Three dimensional fractal flame"
      />
      <header class="brand">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <path d="M22 3 40 35H4Z M22 13 31 29H13Z" />
          <circle cx="22" cy="25" r="16" />
        </svg>
        <div>
          LUMEN APEIRON<small>THE FRACTAL ATLAS</small>
        </div>
      </header>
      <div class="mode">
        {emulated() ? 'DESKTOP XR EMULATION' : 'STEREO FLAME STUDY'}
        <span>01 / VERDANT</span>
      </div>
      <div class="bottom-hud">
        <section class="caption">
          <p class="eyebrow">A WORLD WITHIN A WORLD</p>
          <h1>Irchiinnuss</h1>
          <p>
            A living geometry, suspended among stars.
            <br />
            Lean closer. Look around. Follow its threads.
          </p>
        </section>
        <section class="controls" aria-label="Flame controls">
          <p class="selection" aria-live="polite">
            {selected()
              ? 'Verdant selected · amber resonance'
              : 'Point at the flame to discover it'}
          </p>
          <div class="actions">
            <button
              disabled={!ready()}
              onClick={() => {
                experience.running = !experience.running
                setRunning(experience.running)
              }}
            >
              {running() ? 'Hold motion' : 'Resume motion'}
            </button>
            <Show
              when={immersive()}
              fallback={
                <button
                  class="primary"
                  disabled={!ready() || !supported() || pending()}
                  onClick={enterVR}
                >
                  {pending()
                    ? 'Opening VR…'
                    : emulated()
                      ? 'Try stereo VR'
                      : 'Enter VR'}
                </button>
              }
            >
              <button class="primary" onClick={exitVR}>
                Leave VR
              </button>
            </Show>
          </div>
          <p class="hint">
            Click the flame to select. In VR, point and press the trigger or
            pinch.
            <br />
            Use the headset menu to leave VR.
          </p>
          <Show when={ready() && !supported()}>
            <p class="hint">
              Open this HTTPS page in Quest Browser to enter VR. The desktop
              view remains available.
            </p>
          </Show>
          <Show when={!ready() && !error()}>
            <p role="status">Preparing the flame…</p>
          </Show>
          <Show when={error()}>
            <p class="error" role="alert">
              {error()}
            </p>
          </Show>
        </section>
      </div>
    </main>
  )
}
