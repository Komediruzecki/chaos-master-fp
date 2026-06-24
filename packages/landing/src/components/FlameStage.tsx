import { Root } from '@/lib/Root'
import FlameView from './FlameView'
import type { FlameViewProps } from './FlameView'

/**
 * Single live-GPU flame stage — a WebGPU Root wrapping the shared FlameView.
 * Used for the always-on hero. The gallery instead provides one Root per gated
 * preview under a shared ComputeGate (see GalleryFlames). One WebGPU device is
 * shared across every Root on the page (getWebgpuComponents caches it).
 */
export type FlameStageProps = FlameViewProps

export default function FlameStage(props: FlameStageProps) {
  return (
    <Root adapterOptions={{ powerPreference: 'high-performance' }}>
      <FlameView {...props} />
    </Root>
  )
}
