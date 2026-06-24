import { createSignal, onCleanup, onMount } from 'solid-js'
import { vec2f } from 'typegpu/data'
import { example45 } from '@/flame/examples/example45'
import FlameStage from './FlameStage'

/**
 * Live, real-time GPU flame for the hero — the same renderer the editor draws
 * with, reused via FlameStage. Mounted as a `client:only="solid-js"` island.
 *
 * The hero poster sits behind this island as the non-WebGPU fallback; once the
 * flame accumulates we flag the hero (`is-gpu-ready`) so the poster cross-fades
 * out.
 *
 * Interactivity: the cursor parallaxes the camera over the flame — it perturbs
 * while you move and re-sharpens when you stop (the camera settles, so the
 * accumulation converges again). Honors the hero's "move your cursor" promise.
 */
const PARALLAX = 0.18 // world-units of camera travel edge-to-edge

export default function HeroFlame() {
  const base = example45.renderSettings.camera.position
  const [pos, setPos] = createSignal(vec2f(base[0], base[1]))

  onMount(() => {
    const hero = document.querySelector<HTMLElement>('.hero')
    let tx = 0
    let ty = 0 // target cursor, normalised -1..1
    let cx = 0
    let cy = 0 // eased

    const onMove = (e: PointerEvent) => {
      const r = hero?.getBoundingClientRect()
      if (!r) return
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1
      if (nx < -1.2 || nx > 1.2 || ny < -1.2 || ny > 1.2) return
      tx = nx
      ty = ny
    }
    window.addEventListener('pointermove', onMove)

    let raf = 0
    const tick = () => {
      cx += (tx - cx) * 0.06
      cy += (ty - cy) * 0.06
      const nx = base[0] + cx * PARALLAX
      const ny = base[1] - cy * PARALLAX
      const cur = pos()
      // Only nudge the camera while actually moving; once it settles we stop
      // writing so the flame converges back to full quality.
      if (Math.abs(nx - cur.x) > 5e-4 || Math.abs(ny - cur.y) > 5e-4) {
        setPos(vec2f(nx, ny))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    onCleanup(() => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    })
  })

  return (
    <FlameStage
      flame={example45}
      quality={0.99}
      pointCountPerBatch={256}
      canvasClass="hero-gpu-canvas"
      cameraPosition={pos}
      onReady={() =>
        document.querySelector('.hero')?.classList.add('is-gpu-ready')
      }
    />
  )
}
