import { example45 } from '@/flame/examples/example45'
import FlameStage from './FlameStage'
import { createFlameParallax } from './useFlameParallax'

/**
 * Live flame for the Studio "technical" viewport — the same flame the hero shows
 * (example45), whose real transforms are broken down in the panel beside it.
 * Cursor parallax keyed to the viewport.
 */
export default function StudioFlame() {
  const cameraPosition = createFlameParallax({
    selector: '.studio-viewport',
    base: example45.renderSettings.camera.position,
    amount: 0.14,
  })

  return (
    <FlameStage
      flame={example45}
      quality={0.85}
      pointCountPerBatch={160}
      canvasClass="plate-canvas"
      cameraPosition={cameraPosition}
    />
  )
}
