import { example36 } from '@/flame/examples/example36'
import FlameStage from './FlameStage'

/**
 * Live, drag-to-orbit 3D flame for the community art panel (example36 — a glowing
 * 3D bloom). Reuses the app's WheelZoomCamera3D via FlameView's interactive3D:
 * drag to orbit, scroll to zoom. (Swap in the "earth flame" 3D example here once
 * it's authored.)
 */
export default function CommunityFlame() {
  return (
    <FlameStage
      flame={example36}
      quality={0.9}
      pointCountPerBatch={160}
      canvasClass="plate-canvas"
      interactive3D
    />
  )
}
