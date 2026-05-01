import { createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, Show, Suspense, } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Dynamic } from 'solid-js/web'
import { vec2f, vec3f, vec4f } from 'typegpu/data'
import { clamp } from 'typegpu/std'
import { KeyframeTargetProvider, useKeyframeTarget } from '@/contexts/KeyframeTargetContext'
import { WheelZoomCamera2D } from '@/lib/WheelZoomCamera2D'
import { recordEntries, recordKeys } from '@/utils/record'
import ui from './App.module.css'
import { AffineEditor } from './components/AffineEditor/AffineEditor'
import { Button } from './components/Button/Button'
import { Checkbox } from './components/Checkbox/Checkbox'
import { ColorPicker } from './components/ColorPicker/ColorPicker'
import { Card } from './components/ControlCard/ControlCard'
import { Dropzone } from './components/Dropzone/Dropzone'
import { AppCrashed, WebgpuNotSupported, } from './components/ErrorHandling/ErrorHandling'
import { FlameColorEditor, handleColor, } from './components/FlameColorEditor/FlameColorEditor'
import { createLoadFlame } from './components/LoadFlameModal/LoadFlameModal'
import { Modal } from './components/Modal/Modal'
import { PaletteSelector } from './components/PaletteSelector/PaletteSelector'
import { getPresetFromQuality, QualityPresets, qualityPresets, } from './components/Quality/QualityPresets'
import { createShareLinkModal } from './components/ShareLinkModal/ShareLinkModal'
import { Slider } from './components/Sliders/Slider'
import { TimelineSection } from './components/Timeline/TimelineSection'
import { createVariationSelector } from './components/VariationSelector/VariationSelector'
import { ViewControls } from './components/ViewControls/ViewControls'
import { WelcomeScreen } from './components/WelcomeScreen/WelcomeScreen'
import { ChangeHistoryContextProvider } from './contexts/ChangeHistoryContext'
import { ThemeContextProvider, useTheme } from './contexts/ThemeContext'
import { TimelineContextProvider } from './contexts/TimelineContext'
import { DEFAULT_POINT_COUNT, DEFAULT_QUALITY, DEFAULT_RENDER_INTERVAL_MS, DEFAULT_RESOLUTION, } from './defaults'
import { colorInitModeToImplFn } from './flame/colorInitMode'
import { applyColorMapToFlame } from './flame/colorMap'
import { drawModeToImplFn } from './flame/drawMode'
import { example1 } from './flame/examples/example1'
import { Flam3 } from './flame/Flam3'
import { pointInitModeToImplFn } from './flame/pointInitMode'
import { accumulatedPointCount, qualityPointCountLimit, setCurrentQuality, setQualityPointCountLimit, } from './flame/renderStats'
import { MAX_CAMERA_ZOOM_VALUE, MIN_CAMERA_ZOOM_VALUE, } from './flame/schema/flameSchema'
import { generateTransformId, generateVariationId, } from './flame/transformFunction'
import { isParametricVariation, isVariationType } from './flame/variations'
import { getNormalizedVariationName, getParamsEditor, getVariationDefault } from './flame/variations/utils'
import { Cross, Plus } from './icons'
import { AutoCanvas } from './lib/AutoCanvas'
import { Root } from './lib/Root'
import { createStoreHistory } from './utils/createStoreHistory'
import { addFlameDataToPng } from './utils/flameInPng'
import { compressJsonQueryParam, decodeJsonQueryParam } from './utils/jsonQueryParam'
import { saveRecentFlame } from './utils/recentFlames'
import { sum } from './utils/sum'
import { createTimelineState } from './utils/timeline'
import { useKeyboardShortcuts } from './utils/useKeyboardShortcuts'
import { useLoadFlameFromFile } from './utils/useLoadFlameFromFile'
import { dismissWelcome, hasWelcomeBeenDismissed } from './utils/welcomeDismissed'
import type { Setter } from 'solid-js'
import type { v2f } from 'typegpu/data'
import type { QualityPreset } from './components/Quality/QualityPresets'
import type { ColorInitMode } from './flame/colorInitMode'
import type { ColorMap, Palette } from './flame/colorMap'
import type { DrawMode } from './flame/drawMode'
import type { PointInitMode } from './flame/pointInitMode'
import type { FlameDescriptor, TransformFunction } from './flame/schema/flameSchema'

const EDGE_FADE_COLOR = {
  light: vec4f(0.96, 0.96, 0.96, 1),
  dark: vec4f(0, 0, 0, 0.8),
}

function formatPercent(x: number) {
  if (x === 1) {
    return `100 %`
  }
  return `${(x * 100).toFixed(1)} %`
}

function newDefaultTransform(): TransformFunction {
  return {
    probability: 1,
    color: { x: 0, y: 0 },
    preAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
    postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
    variations: {
      [generateVariationId()]: getVariationDefault('linear', 1.0),
    },
  }
}

export type ExportImageType = (canvas: HTMLCanvasElement) => void

type AppProps = {
  flameFromQuery?: FlameDescriptor
  flameFromWelcome?: () => FlameDescriptor | undefined
  resetFlameFromWelcome?: () => void
}

function App(props: AppProps) {
  const { theme, setTheme } = useTheme()
  const { setTargetedParameter } = useKeyframeTarget()
  const [qualityPreset, setQualityPreset] = createSignal<QualityPreset>(
    getPresetFromQuality(DEFAULT_QUALITY),
  )
  const [pixelRatio, setPixelRatio] = createSignal(DEFAULT_RESOLUTION)
  const [onExportImage, setOnExportImage] = createSignal<ExportImageType>()
  const [adaptiveFilterEnabled, setAdaptiveFilterEnabled] = createSignal(true)
  const [animationEnabled, setAnimationEnabled] = createSignal(true)
  const [showSidebar, setShowSidebar] = createSignal(true)
  const [showTimeline, setShowTimeline] = createSignal(false)
  const [selectedPaletteId, setSelectedPaletteId] =
    createSignal<string>('default')
  const [selectedPalette, setSelectedPalette] = createSignal<
    Palette | undefined
  >(undefined)
  const [flameDescriptor, setFlameDescriptor, history] = createStoreHistory(
    createStore(
      structuredClone(
        props.flameFromWelcome?.() ?? props.flameFromQuery ?? example1,
      ),
    ),
  )
  createEffect(() => {
    const newFlame = props.flameFromWelcome?.()
    if (newFlame !== undefined) {
      history.replace(structuredClone(newFlame))
      props.resetFlameFromWelcome?.()
    }
  })

  const totalProbability = createMemo(() =>
    sum(Object.values(flameDescriptor.transforms).map((f) => f.probability)),
  )
  const { loadModalIsOpen, showLoadFlameModal } = createLoadFlame(history)
  const { showVariationSelector, varSelectorModalIsOpen } =
    createVariationSelector(history)

  const finalRenderInterval = () =>
    loadModalIsOpen() || varSelectorModalIsOpen()
      ? Infinity
      : onExportImage()
        ? 0
        : DEFAULT_RENDER_INTERVAL_MS

  const { showShareLinkModal } = createShareLinkModal(flameDescriptor)

  const handlePaletteSelect = (palette: Palette) => {
    setSelectedPaletteId(palette.id)
    setSelectedPalette(palette)
    // Convert palette entries to color map entries and apply
    const entries = palette.entries.map((entry) => ({ a: entry.a, b: entry.b }))
    const colorMap: ColorMap = {
      id: palette.id,
      name: palette.name,
      entries,
    }
    setFlameDescriptor((draft) => {
      applyColorMapToFlame(draft, colorMap)
    })
  }

  const setFlameZoom: Setter<number> = (value) => {
    if (typeof value === 'function') {
      setFlameDescriptor((draft) => {
        draft.renderSettings.camera.zoom = clamp(
          value(draft.renderSettings.camera.zoom),
          MIN_CAMERA_ZOOM_VALUE,
          MAX_CAMERA_ZOOM_VALUE,
        )
      })
    } else {
      setFlameDescriptor((draft) => {
        draft.renderSettings.camera.zoom = clamp(
          value,
          MIN_CAMERA_ZOOM_VALUE,
          MAX_CAMERA_ZOOM_VALUE,
        )
      })
    }
    return flameDescriptor.renderSettings.camera.zoom
  }
  const setFlamePosition: Setter<v2f> = (value) => {
    if (typeof value === 'function') {
      setFlameDescriptor((draft) => {
        const newPos = value(vec2f(...draft.renderSettings.camera.position))
        draft.renderSettings.camera.position = [newPos.x, newPos.y]
      })
    } else {
      setFlameDescriptor((draft) => {
        draft.renderSettings.camera.position = [value.x, value.y]
      })
    }
    return flameDescriptor.renderSettings.camera.position
  }

  useKeyboardShortcuts({
    KeyF: () => {
      document.startViewTransition(() => {
        setShowSidebar((p) => !p)
      })
      return true
    },
    KeyZ: (ev) => {
      if (ev.metaKey || ev.ctrlKey) {
        if (ev.shiftKey) {
          if (history.hasRedo()) {
            history.redo()
            return true
          }
        } else {
          if (history.hasUndo()) {
            history.undo()
            return true
          }
        }
      }
    },
    KeyY: (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && history.hasRedo()) {
        history.redo()
        return true
      }
    },
    KeyD: () => {
      document.startViewTransition(() => {
        setFlameDescriptor((draft) => {
          draft.renderSettings.drawMode =
            draft.renderSettings.drawMode === 'light' ? 'paint' : 'light'
        })
      })
      return true
    },
  })
  const exportCanvasImage = (canvas: HTMLCanvasElement) => {
    setOnExportImage(undefined)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const imgData = await blob.arrayBuffer()
      const pngBytes = new Uint8Array(imgData)
      const encodedFlames = await compressJsonQueryParam(flameDescriptor)
      const imgExtData = addFlameDataToPng(encodedFlames, pngBytes)
      saveRecentFlame(flameDescriptor)
      const fileUrlExt = URL.createObjectURL(imgExtData)
      const downloadLink = window.document.createElement('a')
      downloadLink.href = fileUrlExt
      downloadLink.download = 'flame.png'
      downloadLink.click()
    })
  }

  createEffect(() => {
    setTheme(
      flameDescriptor.renderSettings.drawMode === 'light' ? 'dark' : 'light',
    )
  })

  const loadFlameFromFile = useLoadFlameFromFile()

  async function onDrop(file: File) {
    const flameDescriptor = await loadFlameFromFile(file)
    if (flameDescriptor) {
      history.replace(flameDescriptor)
    }
  }

  const timeline = createTimelineState()

  // Add initial keyframes for camera animation
  createEffect(() => {
    const t = timeline
    const tracks = t.tracks()
    const currentFrame = t.currentFrame()

    // Add camera keyframes if they don't exist
    const hasCameraX = tracks.some(
      (track: { parameterPath: string }) => track.parameterPath === 'camera.x',
    )
    const hasCameraY = tracks.some(
      (track: { parameterPath: string }) => track.parameterPath === 'camera.y',
    )
    const hasCameraZoom = tracks.some(
      (track: { parameterPath: string }) =>
        track.parameterPath === 'camera.zoom',
    )

    if (
      !(hasCameraX) ||
      !(hasCameraY) ||
      !(hasCameraZoom)
    ) {
      t.addKeyframe(
        'camera.x',
        currentFrame,
        flameDescriptor.renderSettings.camera.position[0],
      )
      t.addKeyframe(
        'camera.y',
        currentFrame,
        flameDescriptor.renderSettings.camera.position[1],
      )
      t.addKeyframe(
        'camera.zoom',
        currentFrame,
        flameDescriptor.renderSettings.camera.zoom,
      )
    }
  })

  return (
    <ChangeHistoryContextProvider value={history}>
      <TimelineContextProvider value={timeline}>
        <Dropzone class={ui.layout} onDrop={onDrop}>
          <>
            <div
              class={ui.canvasContainer}
              classList={{ [ui.fullscreen as string]: !showSidebar() }}
            >
              <AutoCanvas class={ui.canvas} pixelRatio={pixelRatio()}>
                <WheelZoomCamera2D
                  zoom={[
                    () => flameDescriptor.renderSettings.camera.zoom,
                    setFlameZoom,
                  ]}
                  position={[
                    () =>
                      vec2f(...flameDescriptor.renderSettings.camera.position),
                    setFlamePosition,
                  ]}
                >
                  <Flam3
                    quality={qualityPresets[qualityPreset()]}
                    pointCountPerBatch={DEFAULT_POINT_COUNT}
                    adaptiveFilterEnabled={adaptiveFilterEnabled()}
                    animationEnabled={animationEnabled()}
                    flameDescriptor={flameDescriptor}
                    renderInterval={finalRenderInterval()}
                    onExportImage={onExportImage()}
                    edgeFadeColor={
                      showSidebar() ? EDGE_FADE_COLOR[theme()] : vec4f(0)
                    }
                    setCurrentQuality={(fn) => setCurrentQuality(() => fn)}
                    setQualityPointCountLimit={(fn) =>
                      setQualityPointCountLimit(() => fn)
                    }
                    palette={selectedPalette()}
                    onEnterAnimation={() => {
                      const t = timeline
                      t.setIsPlaying(true)
                    }}
                  />
                </WheelZoomCamera2D>
              </AutoCanvas>
            </div>
          </>
          <ViewControls
            zoom={flameDescriptor.renderSettings.camera.zoom}
            setZoom={setFlameZoom}
            setPosition={setFlamePosition}
            pixelRatio={pixelRatio()}
            setPixelRatio={setPixelRatio}
          />

          <Button
            class={ui.timelineToggle}
            onClick={() => {
              document.startViewTransition(() => {
                setShowTimeline(!showTimeline())
              })
            }}
          >
            {showTimeline() ? 'Hide Timeline' : 'Show Timeline'}
          </Button>

          <Show when={showTimeline()}>
            <div class={ui.timelineContainer}>
              <TimelineSection
                onEnterAnimation={() => {
                  const t = timeline
                  t.setIsPlaying(true)
                }}
              />
            </div>
          </Show>
          <Show when={showSidebar()}>
            <div class={ui.sidebar}>
              <AffineEditor
                class={ui.affineEditor}
                transforms={flameDescriptor.transforms}
                setTransforms={(setFn) => {
                  setFlameDescriptor((draft) => {
                    setFn(draft.transforms)
                  })
                }}
              />
              <div
                class={ui.transformGridRow}
                onClick={() => {
                  setTargetedParameter('paletteSpeed')
                }}
              >
                <FlameColorEditor
                  transforms={flameDescriptor.transforms}
                  setTransforms={(setFn) => {
                    setFlameDescriptor((draft) => {
                      setFn(draft.transforms)
                    })
                  }}
                />
              </div>
              <PaletteSelector
                selectedPaletteId={selectedPaletteId()}
                onSelect={handlePaletteSelect}
              />
              <For each={recordEntries(flameDescriptor.transforms)}>
                {([tid, transform]) => (
                  <div class={ui.transformGrid}>
                    <svg class={ui.variationButtonSvgColor}>
                      <g
                        class={ui.variationButtonColor}
                        style={{
                          '--color': handleColor(
                            theme(),
                            vec2f(transform.color.x, transform.color.y),
                          ),
                        }}
                      >
                        <circle class={ui.variationButtonColorCircle} />
                      </g>
                    </svg>
                    <button
                      class={ui.deleteFlameButton}
                      onClick={() => {
                        setFlameDescriptor((draft) => {
                          if (recordKeys(draft.transforms).length === 1) {
                            draft.transforms[tid] = structuredClone(
                              newDefaultTransform(),
                            )
                          } else {
                            delete draft.transforms[tid]
                          }
                        })
                      }}
                    >
                      <Cross />
                    </button>
                    <div
                      classList={{
                        [ui.transformGridRow as string]: true,
                        [ui.transformGridFirstRow as string]: true,
                      }}
                    >
                      <div
                        class={ui.transformGridRow}
                        onClick={() => {
                          setTargetedParameter(`transform.${tid}.probability`)
                        }}
                      >
                        <Slider
                          class={ui.transformGridFirstRow}
                          label="Probability"
                          value={transform.probability}
                          min={0}
                          max={1}
                          step={0.001}
                          onInput={(probability) => {
                            setFlameDescriptor((draft) => {
                              draft.transforms[tid]!.probability = probability
                            })
                          }}
                          formatValue={(value) =>
                            formatPercent(value / totalProbability())
                          }
                          dataParameterPath={`transform.${tid}.probability`}
                        />
                      </div>
                    </div>
                    <For each={recordEntries(transform.variations)}>
                      {([vid, variation]) => (
                        <>
                          <div class={ui.transformGridRow}>
                            <button
                              class={ui.variationButton}
                              value={variation.type}
                              onClick={(_) => {
                                showVariationSelector(
                                  structuredClone(
                                    JSON.parse(JSON.stringify(variation)),
                                  ),
                                  structuredClone(
                                    JSON.parse(JSON.stringify(flameDescriptor)),
                                  ),
                                  tid,
                                  vid,
                                )
                                  .then((newValue) => {
                                    if (
                                      newValue === undefined ||
                                      !isVariationType(newValue.variation.type)
                                    ) {
                                      return
                                    }
                                    setFlameDescriptor((draft) => {
                                      // TODO: what else to update from preview selector,
                                      // if one transform can have multiple variations,
                                      // then transform preAffine should be preserved?
                                      draft.transforms[tid]!.preAffine =
                                        newValue.transform.preAffine
                                      draft.transforms[tid]!.variations[vid] =
                                        newValue.variation
                                    })
                                  })
                                  .catch((err: unknown) => {
                                    console.warn(
                                      'Cannot load this variation, reason: ',
                                      err,
                                    )
                                  })
                              }}
                            >
                              <div class={ui.variationButtonText}>
                                {getNormalizedVariationName(variation.type)}
                              </div>
                            </button>
                            <Slider
                              value={variation.weight}
                              min={0}
                              max={1}
                              step={0.001}
                              onInput={(weight) => {
                                setFlameDescriptor((draft) => {
                                  draft.transforms[tid]!.variations[
                                    vid
                                  ]!.weight = weight
                                })
                              }}
                              formatValue={formatPercent}
                            />
                            <button
                              class={ui.deleteVariationButton}
                              onClick={() => {
                                setFlameDescriptor((draft) => {
                                  if (
                                    recordKeys(
                                      draft.transforms[tid]!.variations,
                                    ).length === 1
                                  ) {
                                    draft.transforms[tid]!.variations[vid] =
                                      structuredClone(
                                        getVariationDefault(variation.type, 1),
                                      )
                                  } else {
                                    delete draft.transforms[tid]!.variations[
                                      vid
                                    ]
                                  }
                                })
                              }}
                            >
                              <Cross />
                            </button>
                          </div>
                          <Show
                            when={isParametricVariation(variation) && variation}
                            keyed
                          >
                            {(variation) => (
                              <div class={ui.transformGridRow}>
                                <Dynamic
                                  {...getParamsEditor(variation)}
                                  setValue={(value) => {
                                    setFlameDescriptor((draft) => {
                                      const variationDraft =
                                        draft.transforms[tid]?.variations[vid]
                                      if (
                                        variationDraft === undefined ||
                                        !isParametricVariation(variationDraft)
                                      ) {
                                        throw new Error(`Unreachable code`)
                                      }
                                      variationDraft.params = value
                                    })
                                  }}
                                />
                              </div>
                            )}
                          </Show>
                        </>
                      )}
                    </For>

                    <button
                      class={ui.addTransformVariationButton}
                      onClick={() => {
                        setFlameDescriptor((draft) => {
                          draft.transforms[tid]!.variations[
                            generateVariationId()
                          ] = structuredClone(getVariationDefault('linear', 1))
                        })
                      }}
                    >
                      <Plus />
                    </button>
                  </div>
                )}
              </For>
              <Card class={ui.buttonCard}>
                <button
                  class={ui.addFlameButton}
                  onClick={() => {
                    setFlameDescriptor((draft) => {
                      draft.transforms[generateTransformId()] = structuredClone(
                        newDefaultTransform(),
                      )
                    })
                  }}
                >
                  <Plus />
                </button>
              </Card>
              <Card>
                <div
                  class={ui.transformGridRow}
                  onClick={() => {
                    setTargetedParameter('exposure')
                  }}
                >
                  <Slider
                    label="Exposure"
                    value={flameDescriptor.renderSettings.exposure}
                    min={-4}
                    max={4}
                    step={0.001}
                    onInput={(newExp) => {
                      setFlameDescriptor((draft) => {
                        draft.renderSettings.exposure = newExp
                      })
                    }}
                    formatValue={(value) => value.toString()}
                    dataParameterPath="exposure"
                  />
                </div>
                <Slider
                  label="Skip Iterations"
                  value={flameDescriptor.renderSettings.skipIters}
                  min={0}
                  max={30}
                  step={1}
                  onInput={(newSkipIters) => {
                    setFlameDescriptor((draft) => {
                      draft.renderSettings.skipIters = newSkipIters
                    })
                  }}
                  formatValue={(value) => value.toString()}
                  dataParameterPath="skipIters"
                />
                <label class={ui.labeledInput}>
                  <span>Draw Mode</span>
                  <select
                    class={ui.select}
                    value={flameDescriptor.renderSettings.drawMode}
                    onChange={(ev) => {
                      const mode = ev.currentTarget.value as DrawMode
                      document.startViewTransition(() => {
                        setFlameDescriptor((draft) => {
                          draft.renderSettings.drawMode = mode
                        })
                      })
                    }}
                  >
                    <For each={recordKeys(drawModeToImplFn)}>
                      {(drawMode) => (
                        <option value={drawMode}>{drawMode}</option>
                      )}
                    </For>
                  </select>
                  <span></span>
                </label>
                <label class={ui.labeledInput}>
                  <span>Color Init Mode</span>
                  <select
                    class={ui.select}
                    value={flameDescriptor.renderSettings.colorInitMode}
                    onChange={(ev) => {
                      const mode = ev.currentTarget.value as ColorInitMode
                      document.startViewTransition(() => {
                        setFlameDescriptor((draft) => {
                          draft.renderSettings.colorInitMode = mode
                        })
                      })
                    }}
                  >
                    <For each={recordKeys(colorInitModeToImplFn)}>
                      {(colorInitMode) => (
                        <option value={colorInitMode}>{colorInitMode}</option>
                      )}
                    </For>
                  </select>
                  <span></span>
                </label>
                <label class={ui.labeledInput}>
                  <span>Point Init</span>
                  <select
                    class={ui.select}
                    value={flameDescriptor.renderSettings.pointInitMode}
                    onChange={(ev) => {
                      const mode = ev.currentTarget.value as PointInitMode
                      document.startViewTransition(() => {
                        setFlameDescriptor((draft) => {
                          draft.renderSettings.pointInitMode = mode
                        })
                      })
                    }}
                  >
                    <For each={recordKeys(pointInitModeToImplFn)}>
                      {(pointInitMode) => (
                        <option value={pointInitMode}>{pointInitMode}</option>
                      )}
                    </For>
                  </select>
                  <span></span>
                </label>
                <div
                  class={ui.transformGridRow}
                  onClick={() => {
                    setTargetedParameter('vibrancy')
                  }}
                >
                  <Slider
                    label="Vibrancy"
                    value={flameDescriptor.renderSettings.vibrancy}
                    min={0}
                    max={1}
                    step={0.05}
                    onInput={(newVibrancy) => {
                      setFlameDescriptor((draft) => {
                        draft.renderSettings.vibrancy = newVibrancy
                      })
                    }}
                    formatValue={(value) => value.toFixed(2)}
                    dataParameterPath="vibrancy"
                  />
                </div>
                <div
                  class={ui.transformGridRow}
                  onClick={() => {
                    setTargetedParameter('backgroundColor')
                  }}
                >
                  <label class={ui.labeledInput}>
                    <span>Background Color</span>
                    <ColorPicker
                      value={
                        flameDescriptor.renderSettings.backgroundColor
                          ? vec3f(
                              ...flameDescriptor.renderSettings.backgroundColor,
                            )
                          : undefined
                      }
                      setValue={(newBgColor) => {
                        setFlameDescriptor((draft) => {
                          draft.renderSettings.backgroundColor = newBgColor
                        })
                      }}
                    />
                  </label>
                </div>
                <Show
                  when={
                    flameDescriptor.renderSettings.backgroundColor !== undefined
                  }
                  fallback={<span class={ui.noSelect} />}
                >
                  <Button
                    onClick={() => {
                      setFlameDescriptor((draft) => {
                        delete draft.renderSettings.backgroundColor
                      })
                    }}
                  >
                    Auto
                  </Button>
                </Show>
                <div class={ui.noSelect}>Quality</div>
                <QualityPresets
                  selectedPreset={qualityPreset()}
                  setQualityPreset={setQualityPreset}
                  fillPercentage={
                    (() => {
                      const limitFn = qualityPointCountLimit()
                      if (!limitFn) return 0
                      const limit = limitFn()
                      if (limit === 0) return 0
                      return Math.min(100, Math.max(0, (accumulatedPointCount() / limit) * 100))
                    })()
                  }
                />
              </Card>
              <Card>
                <label class={ui.labeledInput}>
                  <span>Enable Animation</span>
                  <Checkbox
                    checked={animationEnabled()}
                    onChange={(checked) => setAnimationEnabled(checked)}
                  />
                  <span></span>
                </label>
                <label class={ui.labeledInput}>
                  <span>Adaptive filter</span>
                  <Checkbox
                    checked={adaptiveFilterEnabled()}
                    onChange={(checked) => setAdaptiveFilterEnabled(checked)}
                  />
                  <span></span>
                </label>
              </Card>
              <div class={ui.actionButtons}>
                <Card class={ui.buttonCard}>
                  <button
                    class={ui.addFlameButton}
                    onClick={showLoadFlameModal}
                  >
                    Load Flame
                  </button>
                </Card>
                <Card class={ui.buttonCard}>
                  <button
                    class={ui.addFlameButton}
                    onClick={() => {
                      saveRecentFlame(flameDescriptor)
                    }}
                  >
                    Save for Later
                  </button>
                </Card>
                <Card class={ui.buttonCard}>
                  <button
                    class={ui.addFlameButton}
                    onClick={() => {
                      setOnExportImage(() => exportCanvasImage)
                    }}
                  >
                    Export PNG
                  </button>
                </Card>
                <Card class={ui.buttonCard}>
                  <button
                    class={ui.addFlameButton}
                    onClick={showShareLinkModal}
                  >
                    Share Link
                  </button>
                </Card>
              </div>
            </div>
          </Show>
        </Dropzone>
      </TimelineContextProvider>
    </ChangeHistoryContextProvider>
  )
}

export function Wrappers() {
  const [flameFromQuery] = createResource(async () => {
    const param = new URLSearchParams(window.location.search)
    const flameDef = param.get('flame')
    if (flameDef !== null) {
      try {
        return await decodeJsonQueryParam(flameDef)
      } catch (ex) {
        console.error(ex)
      }
    }
    return undefined
  })

  const [dontShowAgain, setDontShowAgain] = createSignal(false)
  // Don't show welcome if there's a flame in the URL query, or while loading
  const showWelcomeComputed = createMemo(() =>
    !hasWelcomeBeenDismissed() && (flameFromQuery.state === 'ready' && flameFromQuery() !== undefined),
  )
  const [showWelcome, setShowWelcome] = createSignal(showWelcomeComputed())
  const [selectedFlame, setSelectedFlame] = createSignal<
    FlameDescriptor | undefined
  >()

  const errorHandler = (err: unknown, _: () => void) => {
    if (err instanceof Error) {
      if (err.cause === 'WebGPU') {
        return <WebgpuNotSupported />
      }
    }
    console.error(err)
    return <AppCrashed />
  }

  return (
    <ThemeContextProvider>
      <KeyframeTargetProvider>
        <Modal>
          <ErrorBoundary fallback={errorHandler}>
            <Root
              adapterOptions={{
                powerPreference: 'high-performance',
              }}
            >
              <Suspense>
                {/* Always render App in background */}
                <App
                  flameFromQuery={flameFromQuery()}
                  flameFromWelcome={selectedFlame}
                  resetFlameFromWelcome={() => {
                    setSelectedFlame(undefined)
                  }}
                />
                {/* WelcomeScreen overlay on top */}
                <Show when={showWelcome()}>
                  <WelcomeScreen
                    showDontShowAgain={dontShowAgain()}
                    onDontShowAgainChange={(checked) => {
                      setDontShowAgain(checked)
                      if (checked) {
                        dismissWelcome()
                      }
                    }}
                    onEnter={() => setShowWelcome(false)}
                    onSelectFlame={(flame) => setSelectedFlame(() => flame)}
                  />
                </Show>
              </Suspense>
            </Root>
          </ErrorBoundary>
        </Modal>
      </KeyframeTargetProvider>
    </ThemeContextProvider>
  )
}
