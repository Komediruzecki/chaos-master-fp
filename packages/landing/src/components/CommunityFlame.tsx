import { example36 } from '@/flame/examples/example36'
import FlameStage from './FlameStage'

/**
 * Single live flame for the community section's art panel. A 2D example
 * (example36 — a soft magenta nebula); the landing has no 3D camera controls, so
 * we keep this panel 2D rather than render an uncontrollable 3D angle.
 */
export default function CommunityFlame() {
  return (
    <FlameStage
      flame={example36}
      quality={0.9}
      pointCountPerBatch={160}
      canvasClass="plate-canvas"
    />
  )
}
