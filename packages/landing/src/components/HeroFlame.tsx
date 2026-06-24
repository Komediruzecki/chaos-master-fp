import { example45 } from '@/flame/examples/example45'
import FlameStage from './FlameStage'

/**
 * Live, real-time GPU flame for the hero — the same renderer the editor draws
 * with, reused via FlameStage. Mounted as a `client:only="solid-js"` island.
 *
 * The hero poster sits behind this island as the non-WebGPU fallback. Once the
 * flame is actually accumulating on the GPU we flag the hero (`is-gpu-ready`) so
 * the poster cross-fades out — if WebGPU never comes up, onReady never fires and
 * the poster stays.
 */
export default function HeroFlame() {
  return (
    <FlameStage
      flame={example45}
      quality={0.99}
      pointCountPerBatch={256}
      canvasClass="hero-gpu-canvas"
      onReady={() =>
        document.querySelector('.hero')?.classList.add('is-gpu-ready')
      }
    />
  )
}
