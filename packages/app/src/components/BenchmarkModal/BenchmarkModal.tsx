import { createResource, createSignal, Show, Suspense } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { DEFAULT_POINT_COUNT } from '@/defaults'
import { examples } from '@/flame/examples'
import { Flam3 } from '@/flame/Flam3'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Root } from '@/lib/Root'
import { getWebgpuComponents } from '@/lib/WebgpuAdapter'
import { WheelZoomCamera2D } from '@/lib/WheelZoomCamera2D'
import { formatBytes } from '@/utils/formatBytes'
import { GIT_SHA, VERSION } from '@/version'
import { useRequestModal } from '../Modal/ModalContext'
import ui from './BenchmarkModal.module.css'

const BENCHMARK_SECONDS = 10

async function getGPUDeviceInformation() {
  const { adapter } = await getWebgpuComponents({
    powerPreference: 'high-performance',
  })
  const { info, limits } = adapter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memoryHeaps: { size: number }[] | undefined = (info as any).memoryHeaps
  const heaps = memoryHeaps?.map((m) => m.size)

  return {
    description: info.description,
    vendor: info.vendor,
    architecture: info.architecture,
    maxBufferSize: limits.maxBufferSize,
    heaps,
  }
}

function gatherBenchmarkLog(
  bps: number,
  gpuInfo?: Awaited<ReturnType<typeof getGPUDeviceInformation>>,
): string {
  const lines: string[] = []
  const { navigator: n } = globalThis

  lines.push('**Chaos Master Benchmark**')
  lines.push(`Version  : ${VERSION}${GIT_SHA ? ` (${GIT_SHA})` : ''}`)

  if (gpuInfo) {
    if (gpuInfo.description) lines.push(`GPU      : ${gpuInfo.description}`)
    lines.push(`Vendor   : ${gpuInfo.vendor}`)
    if (gpuInfo.architecture) lines.push(`Arch     : ${gpuInfo.architecture}`)
    if (gpuInfo.heaps) {
      lines.push(
        `VRAM     : ${gpuInfo.heaps.map((s) => formatBytes(s)).join(' + ')}`,
      )
    }
  }

  if (n.hardwareConcurrency) {
    lines.push(`CPU      : ${n.hardwareConcurrency} cores`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceMemory = (n as any).deviceMemory as number | undefined
  if (deviceMemory !== undefined) {
    lines.push(`RAM      : ~${deviceMemory} GB`)
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  lines.push(`Platform : ${n.platform}`)
  lines.push(`BPS      : ${bps.toFixed(3)}`)

  return lines.join('\n')
}

type BenchmarkState = 'idle' | 'running' | 'complete'

function BenchmarkModal(props: { respond: () => void }) {
  const [gpuDeviceInfo] = createResource(getGPUDeviceInformation)
  const [state, setState] = createSignal<BenchmarkState>('idle')
  const [_accumulatedPoints, setAccumulatedPoints] = createSignal(0)
  const [liveBps, setLiveBps] = createSignal(0)
  const [progress, setProgress] = createSignal(0)
  const [finalBps, setFinalBps] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  let startTime = 0
  let running = false

  function handleStart() {
    setAccumulatedPoints(0)
    setLiveBps(0)
    setProgress(0)
    setFinalBps(0)
    startTime = 0
    running = true
    setState('running')
  }

  function handleCancel() {
    running = false
    setState('idle')
    startTime = 0
    setAccumulatedPoints(0)
  }

  function handleAccumulatedPoints(count: number) {
    if (!running) return

    if (count === 0) return

    if (startTime === 0) {
      startTime = globalThis.performance.now()
    }

    const elapsed = (globalThis.performance.now() - startTime) / 1000
    setAccumulatedPoints(count)
    setLiveBps(count / elapsed / 1e9)
    setProgress(Math.min((elapsed / BENCHMARK_SECONDS) * 100, 100))

    if (elapsed >= BENCHMARK_SECONDS) {
      running = false
      setFinalBps(count / elapsed / 1e9)
      setState('complete')
    }
  }

  function copyBenchmarkLog() {
    const text = gatherBenchmarkLog(finalBps(), gpuDeviceInfo())
    void globalThis.navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const cameraZoom = createSignal(1)
  const cameraPosition = createSignal(vec2f(0, 0))

  return (
    <>
      <div class={ui.heroSection}>
        <h1 class={ui.heroTitle}>Benchmark</h1>
        <button
          class={ui.closeBtn}
          onClick={() => {
            props.respond()
          }}
          title="Close"
        >
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path
              fill="currentColor"
              d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"
            />
          </svg>
        </button>
      </div>

      <Show when={state() === 'idle'}>
        <div class={ui.stateSection}>
          <p class={ui.descText}>
            Run a standardized IFS fractal render for {BENCHMARK_SECONDS} seconds to
            measure your GPU's performance in Billions of Points Per Second (BPS).
            The result can be shared on Discord for leaderboard challenges.
          </p>
          <button class={ui.runBtn} onClick={handleStart}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Run Benchmark
          </button>
        </div>
      </Show>

      <Show when={state() === 'running'}>
        <div class={ui.runningSection}>
          <div class={ui.progressWrap}>
            <div class={ui.progressBar}>
              <div
                class={ui.progressFill}
                style={{ width: `${progress()}%` }}
              />
            </div>
            <div class={ui.progressStats}>
              <span class={ui.liveBps}>{liveBps().toFixed(3)} B/s</span>
              <span class={ui.progressPct}>{progress().toFixed(0)}%</span>
            </div>
          </div>
          <button class={ui.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        </div>
        <div class={ui.previewCanvas}>
          <Root adapterOptions={{ powerPreference: 'high-performance' }}>
            <AutoCanvas
              fixedResolution={{ width: 256, height: 256 }}
              alphaMode="opaque"
            >
              <WheelZoomCamera2D
                zoom={cameraZoom}
                position={cameraPosition}
                interactive={() => false}
              >
                <Flam3
                  quality={0.999}
                  pointCountPerBatch={DEFAULT_POINT_COUNT}
                  adaptiveFilterEnabled={false}
                  animationEnabled={false}
                  flameDescriptor={examples.benchmark}
                  renderInterval={0}
                  disableQualityLimit={true}
                  edgeFadeColor={vec4f(0)}
                  palette={() => undefined}
                  outputAlpha={false}
                  onAccumulatedPointCount={handleAccumulatedPoints}
                />
              </WheelZoomCamera2D>
            </AutoCanvas>
          </Root>
        </div>
      </Show>

      <Show when={state() === 'complete'}>
        <div class={ui.completeSection}>
          <div class={ui.resultCard}>
            <div class={ui.bpsNumber}>{finalBps().toFixed(3)}</div>
            <div class={ui.bpsLabel}>Billions of Points / Second</div>
          </div>
        </div>
      </Show>

      <div class={ui.deviceHeader}>
        <h2 class={ui.sectionTitle}>Device Info</h2>
      </div>
      <div class={ui.deviceSection}>
        <Suspense
          fallback={<span class={ui.deviceLoading}>Querying GPU...</span>}
        >
          <Show when={gpuDeviceInfo()} keyed>
            {(deviceInfo) => {
              const rows: {
                label: string
                value: string
                color: 'green' | 'blue'
              }[] = []
              if (deviceInfo.description !== '') {
                rows.push({
                  label: 'Device',
                  value: deviceInfo.description,
                  color: 'green',
                })
              }
              rows.push({
                label: 'Vendor',
                value: deviceInfo.vendor,
                color: 'blue',
              })
              if (deviceInfo.architecture !== '') {
                rows.push({
                  label: 'Architecture',
                  value: deviceInfo.architecture,
                  color: 'blue',
                })
              }
              if (deviceInfo.heaps) {
                rows.push({
                  label: 'VRAM',
                  value: deviceInfo.heaps
                    .map((size) => formatBytes(size))
                    .join(' + '),
                  color: 'green',
                })
              }
              return (
                <div class={ui.deviceGrid}>
                  {rows.map((row) => (
                    <>
                      <span class={ui.deviceLabel}>{row.label}</span>
                      <span class={ui.deviceValue}>
                        <span
                          class={ui.devicePill}
                          classList={{
                            [ui.devicePillBlue!]: row.color === 'blue',
                          }}
                        >
                          {row.value}
                        </span>
                      </span>
                    </>
                  ))}
                </div>
              )
            }}
          </Show>
        </Suspense>
      </div>

      <Show when={state() === 'complete'}>
        <div class={ui.footer}>
          <button
            class={ui.copyBtn}
            classList={{ [ui.copyBtnCopied!]: copied() }}
            onClick={copyBenchmarkLog}
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              width="14"
              height="14"
            >
              {copied() ? (
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
              ) : (
                <path d="M4 2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1v-1H4V3h7v2h1V3a1 1 0 0 0-1-1H4zm3 4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H7zm0 1h7v7H7V7z" />
              )}
            </svg>
            {copied() ? 'Copied!' : 'Copy Benchmark Log'}
          </button>
        </div>
        <div class={ui.caveatSection}>
          Share your result in the #benchmarks channel on Discord. Scores
          measured across different GPUs and browsers are not directly
          comparable — this is for fun!
        </div>
      </Show>
    </>
  )
}

export function createShowBenchmark() {
  const requestModal = useRequestModal()

  async function showBenchmark() {
    await requestModal({
      class: ui.benchmarkModal,
      content: ({ respond }) => <BenchmarkModal respond={respond} />,
    })
  }

  return showBenchmark
}
