import { createMemo, createSignal } from 'solid-js'
import { useTimeline } from '@/contexts/TimelineContext'
import { TIMELINE_PARAMETERS } from '@/utils/timeline'
import { clamp } from '@/utils/easing'
import ui from './KeyframeCurvePreview.module.css'

interface CurvePreviewProps {
  parameterPath: string
  className?: string
}

function CubicBezier(
  t: number,
  [p1x, p1y, p2x, p2y]: [number, number, number, number],
): number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx

  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by

  function sampleCurveX(t: number): number {
    return ((ax * t + bx) * t + cx) * t
  }

  function sampleCurveY(t: number): number {
    return ((ay * t + by) * t + cy) * t
  }

  function solveCurveX(t: number, x: number): number {
    let t2 = t
    let x2 = x
    for (let i = 0; i < 8; i++) {
      const x3 = sampleCurveX(t2) - x
      if (Math.abs(x3) < 0.000001) {
        return t2
      }
      const dx = (3 * ax * t2 + 2 * bx) * t2 + cx
      t2 = t2 - x3 / dx
    }
    return t2
  }

  return sampleCurveY(solveCurveX(t, t))
}

function LinearBezier(t: number, [t0, t1]: [number, number]): number {
  return t0 + (t1 - t0) * t
}

interface EasingVisualizerProps {
  frameStart: number
  frameEnd: number
  frameCurrent: number
  valueStart: number
  valueEnd: number
  easing?: string
  type: 'number' | 'string' | 'array'
}

function EasingVisualizer(props: EasingVisualizerProps) {
  const { frameStart, frameEnd, frameCurrent, valueStart, valueEnd, easing, type } = props

  // Convert value range to 0-1 for visualization
  const rangeMin = Math.min(valueStart, valueEnd)
  const rangeMax = Math.max(valueStart, valueEnd)
  const range = rangeMax - rangeMin || 1

  const tStart = 0
  const tEnd = 1
  const tCurrent = (frameCurrent - frameStart) / (frameEnd - frameStart)

  let tEased: number
  let curvePoints: { x: number; y: number }[] = []

  if (tCurrent < tStart || tCurrent > tEnd) {
    tEased = tCurrent < tStart ? tStart : tEnd
  } else {
    switch (easing) {
      case 'linear':
        tEased = tCurrent
        break
      case 'easeIn':
        tEased = tCurrent * tCurrent
        break
      case 'easeOut':
        tEased = tCurrent * (2 - tCurrent)
        break
      case 'easeInOut':
        tEased = tCurrent < 0.5 ? 2 * tCurrent * tCurrent : -1 + (4 - 2 * tCurrent) * tCurrent
        break
      case 'bounce':
        const duration = 1 / 3
        if (tCurrent < duration) {
          tEased = tCurrent * tCurrent * tCurrent
        } else {
          const remaining = tCurrent - duration
          tEased = 1 + remaining * remaining * remaining
        }
        break
      case 'elastic':
        const c4 = (2 * Math.PI) / 3
        if (tCurrent === 0 || tCurrent === 1) {
          tEased = tCurrent
        } else {
          tEased = Math.pow(2, -10 * tCurrent) * Math.sin((tCurrent * 10 - 0.75) * c4) + 1
        }
        break
      default:
        tEased = tCurrent
    }
  }

  const value = rangeMin + tEased * range

  // Generate curve points
  for (let i = 0; i <= 20; i++) {
    const step = i / 20
    const stepT = clamp(step, tStart, tEnd)

    if (easing && easing !== 'linear') {
      const point = generateCurvePoint(stepT, easing, tStart, tEnd, valueStart, valueEnd)
      curvePoints.push(point)
    } else {
      curvePoints.push({
        x: (stepT - tStart) / (tEnd - tStart),
        y: (stepT - tStart) / (tEnd - tStart),
      })
    }
  }

  return (
    <div class={ui.easingVisualizer}>
      <svg class={ui.easingSvg} viewBox="0 0 100 40" preserveAspectRatio="none">
        <polyline
          points={curvePoints.map((p) => `${p.x * 100},${p.y * 40}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          class={ui.curveLine}
        />
        <line
          x1="0"
          y1="40"
          x2="100"
          y2="40"
          stroke="currentColor"
          strokeWidth="0.5"
          opacity="0.3"
        />
        <circle cx={tEased * 100} cy={40 - value} r="3" fill="currentColor" />
      </svg>
      <span class={ui.easingValue}>{value.toFixed(type === 'array' ? 1 : 2)}</span>
    </div>
  )
}

function generateCurvePoint(t: number, easing: string, tStart: number, tEnd: number, vStart: number, vEnd: number): { x: number; y: number } {
  const range = tEnd - tStart
  const rangeV = vEnd - vStart || 1

  let tEased: number
  switch (easing) {
    case 'easeIn':
      tEased = ((t - tStart) / range) ** 2
      break
    case 'easeOut':
      const normT = (t - tStart) / range
      tEased = normT * (2 - normT)
      break
    case 'easeInOut':
      const normT = (t - tStart) / range
      tEased = normT < 0.5 ? 2 * normT * normT : -1 + (4 - 2 * normT) * normT
      break
    case 'bounce':
      const bounceT = (t - tStart) / range
      tEased = bounceT < 1 / 3 ? bounceT ** 3 : 1 + (bounceT - 1 / 3) ** 3
      break
    case 'elastic':
      const c4 = (2 * Math.PI) / 3
      if (t === 0 || t === tEnd) {
        tEased = 0
      } else {
        tEased = Math.pow(2, -10 * ((t - tStart) / range)) * Math.sin(((t - tStart) / range) * 10 - 0.75) + 1
      }
      break
    default:
      tEased = (t - tStart) / range
  }

  return {
    x: (t - tStart) / range,
    y: (tEased * rangeV) / rangeV,
  }
}

export function KeyframeCurvePreview(props: CurvePreviewProps) {
  const timeline = useTimeline()!

  const parameterPath = () => props.parameterPath
  const tracks = createMemo(() => timeline.tracks())
  const currentFrame = createMemo(() => timeline.currentFrame())

  const track = createMemo(() => {
    const path = parameterPath()
    return tracks().find((t) => t.parameterPath === path)
  })

  const keyframes = createMemo(() => {
    const t = track()
    return t?.keyframes || []
  })

  const isNumberValue = createMemo(() => {
    const param = TIMELINE_PARAMETERS.find((p) => p.path === parameterPath())
    return param?.type === 'number'
  })

  const sortedKeyframes = createMemo(() => {
    return [...keyframes()].sort((a, b) => a.frame - b.frame)
  })

  const frameWidth = 30
  const curveHeight = 60

  return (
    <div class={ui.previewContainer} classList={{ [props.className || '']: true }}>
      <div class={ui.header}>
        <span class={ui.parameterName}>{parameterPath()}</span>
        <span class={ui.frameIndicator}>Frame: {currentFrame()}</span>
      </div>

      <Show when={sortedKeyframes().length >= 2 && isNumberValue()}>
        <div class={ui.curveContainer}>
          <svg class={ui.curveSvg} viewBox="0 0 200 70" preserveAspectRatio="none">
            {/* Grid lines */}
            <line x1="0" y1="35" x2="200" y2="35" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
            <line x1="100" y1="0" x2="100" y2="70" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />

            {/* Keyframe markers */}
            {sortedKeyframes().map((kf, i) => {
              const x = (kf.frame * frameWidth + frameWidth / 2) / 200 * 200
              const y = 35

              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="3" fill="currentColor" />
                  <text x={x} y="10" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.7">
                    {kf.frame}
                  </text>
                </g>
              )
            })}

            {/* Curve line */}
            <polyline
              points={sortedKeyframes()
                .map((kf, i) => {
                  const x = (kf.frame * frameWidth + frameWidth / 2) / 200 * 200
                  const y = 35
                  return `${x},${y}`
                })
                .join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeOpacity="0.6"
            />

            {/* Current frame marker */}
            {sortedKeyframes().length >= 2 && currentFrame() !== undefined && (
              <circle
                cx={(currentFrame() * frameWidth + frameWidth / 2) / 200 * 200}
                cy="35"
                r="3"
                fill="var(--accent-color)"
              />
            )}
          </svg>

          <div class={ui.valueDisplay}>
            {sortedKeyframes().map((kf, i) => {
              if (i === 0) return null
              const prev = sortedKeyframes()[i - 1]!
              return (
                <div
                  key={i}
                  class={ui.valueCard}
                  style={{
                    left: `${Math.min(kf.frame * frameWidth, 190)}px`,
                    top: '0px',
                  }}
                >
                  <span class={ui.valueLabel}>
                    {prev.frame} → {kf.frame}
                  </span>
                  <div class={ui.valueTooltip}>
                    <div class={ui.easingName}>
                      {kf.easing || 'Linear'}
                    </div>
                    <div class={ui.valueRow}>
                      <span>Value: {kf.value}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Time scale indicator */}
        <div class={ui.timeScale}>
          <span>0s</span>
          <span>1s</span>
          <span>2s</span>
          <span>3s</span>
        </div>
      </Show>

      <Show when={sortedKeyframes().length < 2 || !isNumberValue()}>
        <div class={ui.placeholder}>
          {sortedKeyframes().length < 2 ? (
            <span>Add at least 2 keyframes to see the curve</span>
          ) : (
            <span>This parameter doesn't support curve preview</span>
          )}
        </div>
      </Show>
    </div>
  )
}
