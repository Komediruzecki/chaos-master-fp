// Probe each native dependency independently; desktop GPU is not XR proof.
export interface Capabilities {
  secure: boolean
  webgpu: boolean
  webxr: boolean
  binding: boolean
  immersive: boolean
  xrAdapterRequested: boolean
  xrCandidate: boolean
  adapter: string
  message: string
}

export async function acquireDevice() {
  const caps: Capabilities = {
    secure: window.isSecureContext,
    webgpu: !!window.navigator.gpu,
    webxr: !!window.navigator.xr,
    binding: typeof window.XRGPUBinding === 'function',
    immersive: false,
    xrAdapterRequested: false,
    xrCandidate: false,
    adapter: '',
    message: '',
  }
  if (!caps.secure) throw new Error('Open this lab over HTTPS (or localhost).')
  if (!caps.webgpu) throw new Error('WebGPU is unavailable in this browser.')
  caps.immersive =
    (await window.navigator.xr
      ?.isSessionSupported('immersive-vr')
      .catch(() => false)) ?? false
  let adapter: GPUAdapter | null = null
  if (caps.binding && caps.immersive) {
    caps.xrAdapterRequested = true
    adapter = await window.navigator.gpu
      .requestAdapter({ xrCompatible: true })
      .catch(() => null)
    caps.xrCandidate = !!adapter
  }
  if (!adapter) adapter = await window.navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No WebGPU adapter was returned.')
  const info = adapter.info
  caps.adapter = [info.vendor, info.architecture, info.device, info.description]
    .filter(Boolean)
    .join(' / ')
  caps.message = caps.xrCandidate
    ? 'Native entry can be attempted; only rendered headset frames prove this binding works.'
    : !caps.binding
      ? 'XRGPUBinding is unavailable. Desktop WebGPU works; native WebGPU VR is untested here.'
      : !caps.immersive
        ? 'No immersive headset session is available. Connect the Quest and open this URL there.'
        : 'The XR-compatible adapter request failed. This device is for desktop inspection only.'
  return {
    device: await adapter.requestDevice({ label: 'Lumen WebGPU XR proof' }),
    caps,
  }
}
