import { example44 } from '@/flame/examples/example44'
import FlameStage from './FlameStage'

/**
 * Single live flame for the community section's art panel — a distinct (3D)
 * example for variety. Mounted client-only; FlameView handles the 3D camera.
 */
export default function CommunityFlame() {
  return (
    <FlameStage
      flame={example44}
      quality={0.85}
      pointCountPerBatch={128}
      canvasClass="plate-canvas"
    />
  )
}
