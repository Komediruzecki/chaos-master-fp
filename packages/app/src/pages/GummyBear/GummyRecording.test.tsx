/** The live recording controls own one take through scene switches and responsive hosts. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { onCleanup } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GummyBearPage } from './GummyBearPage'
import type { GummyBearSceneProps } from '@/components/GummyBear/GummyBearScene'
import type { startLiveCanvasRecording } from '@/utils/liveCanvasRecorder'

const mocks = vi.hoisted(() => ({
  supported: true,
  start: vi.fn(),
  download: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  props: undefined as GummyBearSceneProps | undefined,
  callbacks: undefined as
    | Parameters<typeof startLiveCanvasRecording>[1]
    | undefined,
}))
vi.mock('@/utils/liveCanvasRecorder', () => ({
  supportsLiveCanvasRecording: () => mocks.supported,
  startLiveCanvasRecording: mocks.start,
}))
vi.mock('@/utils/blob', () => ({ downloadBlob: mocks.download }))
vi.mock('@/components/GummyBear/ParticleGummyBearScene', () => ({
  ParticleGummyBearScene: (props: GummyBearSceneProps) => {
    mocks.props = props
    props.onReady?.(true)
    onCleanup(() => props.onReady?.(false))
    return <canvas width="640" height="480" />
  },
}))
vi.mock('@/components/GummyBear/GummyBearScene', () => ({
  GummyBearScene: (props: GummyBearSceneProps) => {
    mocks.props = props
    props.onReady?.(true)
    onCleanup(() => props.onReady?.(false))
    return <canvas width="640" height="480" />
  },
}))

let oldUrl: string
beforeEach(() => {
  oldUrl = window.location.href
  window.history.replaceState(null, '', '?experiment=mpm')
  mocks.supported = true
  mocks.props = undefined
  mocks.callbacks = undefined
  vi.clearAllMocks()
  mocks.start.mockImplementation(
    (_canvas, callbacks: Parameters<typeof startLiveCanvasRecording>[1]) => {
      mocks.callbacks = callbacks
      return {
        stop: mocks.stop,
        dispose: mocks.dispose,
        capture: {
          width: 640,
          height: 480,
          requestedFrameRate: callbacks.quality === 'standard' ? 30 : 60,
          requestedBitsPerSecond:
            callbacks.quality === 'standard' ? 8_000_000 : 12_000_000,
        },
      }
    },
  )
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', oldUrl)
  vi.restoreAllMocks()
})

function finish() {
  const blob = new Blob(['encoded frames'], { type: 'video/mp4' })
  mocks.callbacks!.onComplete({
    blob,
    extension: 'mp4',
    durationSeconds: 2.9,
    capture: {
      width: 640,
      height: 480,
      requestedFrameRate: 60,
      requestedBitsPerSecond: 12_000_000,
    },
    encoderBitsPerSecond: 11_000_000,
  })
  return blob
}

describe('Gummy canvas recording controls', () => {
  it('records the local canvas, shows elapsed time and downloads the finished file on request', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(mocks.start.mock.calls[0]?.[0]).toBeInstanceOf(HTMLCanvasElement)
    expect(mocks.callbacks?.quality).toBe('high')
    expect(screen.getByText(/640 × 480 · 60 fps target/).textContent).toContain(
      '12.0 Mbps requested',
    )
    expect(mocks.props?.recording).toBe(true)
    mocks.callbacks!.onElapsed(2.9)
    expect(screen.getByLabelText('Recording time').textContent).toBe('00:02')
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('gummy-recording-status').dataset.state).toBe(
      'stopping',
    )
    expect(mocks.download).not.toHaveBeenCalled()
    const blob = finish()
    expect(screen.getByText(/640 × 480 · 60 fps target/).textContent).toContain(
      '11.0 Mbps encoder setting',
    )
    expect(mocks.props?.recording).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(mocks.download).toHaveBeenCalledWith(
      blob,
      expect.stringMatching(/^gummy-.*\.mp4$/),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Download video' })
        .disabled,
    ).toBe(true)
  })

  it('forwards the Standard profile and locks the profile until the clip is finished', () => {
    render(() => <GummyBearPage />)
    const quality = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Recording quality',
    })
    fireEvent.change(quality, { target: { value: 'standard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(mocks.callbacks?.quality).toBe('standard')
    expect(quality.disabled).toBe(true)
    expect(screen.getByText(/640 × 480 · 30 fps target/).textContent).toContain(
      '8.0 Mbps requested',
    )
    fireEvent.change(quality, { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(quality.disabled).toBe(true)
    finish()
    expect(quality.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(mocks.callbacks?.quality).toBe('standard')
  })

  it('finishes the take when the model replaces its canvas and retains it for downloading', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuous jelly' }))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    const blob = finish()
    fireEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(mocks.download.mock.calls[0]?.[0]).toBe(blob)
  })

  it('preserves paused simulation and lets the camera change while recording', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }))
    expect(mocks.props?.mode).toBe('pan')
    expect(mocks.props?.paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }))
    expect(mocks.props?.mode).toBe('orbit')
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('keeps an earlier download if starting another recording fails', () => {
    render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    const blob = finish()
    mocks.start.mockImplementationOnce(() => {
      throw new Error('Encoder unavailable.')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(screen.getByTestId('gummy-recording-status').textContent).toContain(
      'Encoder unavailable.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(mocks.download.mock.calls[0]?.[0]).toBe(blob)
  })

  it('disables recording with a clear fallback when browser capture is unavailable', () => {
    mocks.supported = false
    render(() => <GummyBearPage />)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Record',
      }).disabled,
    ).toBe(true)
    expect(screen.getByTestId('gummy-recording-status').textContent).toContain(
      'unavailable in this browser',
    )
  })

  it('disposes the capture on navigation and ignores late completion', () => {
    const mounted = render(() => <GummyBearPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    mounted.unmount()
    expect(mocks.dispose).toHaveBeenCalledTimes(1)
    finish()
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
