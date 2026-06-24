import { example44 } from '@/flame/examples/example44'
import { example46 } from '@/flame/examples/example46'
import FlameStage from './FlameStage'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * A drag-to-orbit 3D flame for the community showcase cards. Reuses the app's
 * real renderer (Flam3) + WheelZoomCamera3D via FlameView's interactive3D, with a
 * premultiplied (transparent) canvas so the starfield behind it shows through.
 */
const FLAMES: Record<string, FlameDescriptor> = {
  earth: example46,
  rose: example44,
}

export default function OrbitFlame(props: { which: 'earth' | 'rose' }) {
  return (
    <FlameStage
      flame={FLAMES[props.which]}
      quality={0.9}
      pointCountPerBatch={160}
      canvasClass="plate-canvas"
      interactive3D
      alphaMode="premultiplied"
      outputAlpha
    />
  )
}
