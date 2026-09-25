// Capability and frame evidence remain readable when immersive entry is unavailable.
import { Show } from 'solid-js'
import type { LabRuntime } from './runtime'

export function Diagnostics(props: {
  state?: ReturnType<LabRuntime['snapshot']>
  exportReport: () => void
}) {
  return (
    <section class="diagnostics" aria-label="WebGPU diagnostics">
      <p class="eyebrow">
        {props.state?.immersive
          ? 'NATIVE XR SESSION'
          : props.state?.stereoPreview
            ? 'TWO CAMERAS / DESKTOP ONLY'
            : 'DESKTOP WEBGPU'}
      </p>
      <p class="status" role="status">
        {props.state?.caps?.message ?? 'Preparing the GPU and flame…'}
      </p>
      <Show when={props.state?.error}>
        <p role="alert">{props.state?.error}</p>
      </Show>
      <dl>
        <div>
          <dt>Particles</dt>
          <dd>{props.state?.pointCount?.toLocaleString() ?? '—'}</dd>
        </div>
        <div>
          <dt>GPU generations</dt>
          <dd>{props.state?.generation ?? '—'}</dd>
        </div>
        <div>
          <dt>Native XR frames</dt>
          <dd>{props.state?.nativeFrames ?? 0}</dd>
        </div>
      </dl>
      <button
        class="export"
        onClick={props.exportReport}
        disabled={!props.state}
      >
        Save diagnostic report
      </button>
    </section>
  )
}
