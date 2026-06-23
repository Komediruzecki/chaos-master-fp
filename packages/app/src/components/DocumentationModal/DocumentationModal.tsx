import { createMemo, createSignal, createEffect, For, onMount, Show } from 'solid-js'
import { useRequestModal } from '@/components/Modal/ModalContext'
import { VariationPreview } from '@/components/VariationSelector/VariationSelector'
import { ComputeGate } from '@/contexts/ComputeGateContext'
import { useTheme } from '@/contexts/ThemeContext'
import { COMPUTE_GATE_CAPACITY } from '@/defaults'
import { allTransformVariations, variationTypes } from '@/flame/variations'
import { VARIATION_DOCS } from '@/flame/variations/documentation'
import { getNormalizedVariationName, getVariationPreviewFlame, getVariationPreviewFlame3D, } from '@/flame/variations/utils'
import { variationTypes3D } from '@/flame/variations3D'
import { Root } from '@/lib/Root'
import { ensureMathJax, renderTexToSvg } from '@/utils/mathjax'
import ui from './DocumentationModal.module.css'
import type { VariationDoc } from '@/flame/variations/documentation'

type DocTab = 'variations' | 'ifs' | 'api'
type CodeSubTab = 'math' | 'code'

function StaticMath(props: {
  tex: string
  display?: boolean
  loaded: () => boolean
}) {
  const rendered = createMemo(() => {
    if (!props.loaded()) return null
    return renderTexToSvg(props.tex, props.display ?? true)
  })

  return (
    <Show when={rendered()} fallback={<code>{props.tex}</code>}>
      <span innerHTML={rendered()!} />
    </Show>
  )
}

interface DocumentationModalProps {
  respond: () => void
}

export function DocumentationModal(props: DocumentationModalProps) {
  const [activeTab, setActiveTab] = createSignal<DocTab>('variations')
  const [activeCodeTab, setActiveCodeTab] = createSignal<CodeSubTab>('math')
  const [selectedVar, setSelectedVar] = createSignal<string>('linearVar')
  const [searchQuery, setSearchQuery] = createSignal('')
  const [dimension, setDimension] = createSignal<2 | 3>(2)
  const [mathJaxLoaded, setMathJaxLoaded] = createSignal(false)
  const [mathJaxError, setMathJaxError] = createSignal<string | null>(null)

  const { theme } = useTheme()

  onMount(() => {
    ensureMathJax()
      .then(() => {
        setMathJaxLoaded(true)
      })
      .catch((err: unknown) => {
        setMathJaxError(err instanceof Error ? err.message : String(err))
      })
  })

  // List of all variations in selected dimension
  const variationsList = createMemo(() => {
    return dimension() === 3 ? variationTypes3D : variationTypes
  })

  // Filtered variations based on search query
  const filteredVariations = createMemo(() => {
    const query = searchQuery().trim().toLowerCase()
    if (!query) return variationsList()
    return variationsList().filter((v) =>
      getNormalizedVariationName(v).toLowerCase().includes(query),
    )
  })

  const [visibleCount, setVisibleCount] = createSignal(20)

  // Reset visible count when variations change (e.g. by search or 2D/3D toggle)
  createEffect(() => {
    filteredVariations()
    setVisibleCount(20)
  })

  const visibleVariations = createMemo(() => {
    return filteredVariations().slice(0, visibleCount())
  })

  // Selected variation documentation
  const currentDoc = createMemo<VariationDoc>(() => {
    const vKey = selectedVar()
    const doc = VARIATION_DOCS[vKey]
    if (doc) return doc

    // Auto-generate doc if missing
    const isParametric =
      vKey in allTransformVariations &&
      'paramDefaults' in
        (allTransformVariations[vKey as keyof typeof allTransformVariations] ||
          {})
    return {
      name: getNormalizedVariationName(vKey),
      description: `The ${getNormalizedVariationName(vKey)} fractal transformation.`,
      math: `F(x, y) = w \\cdot \\text{${getNormalizedVariationName(vKey)}}(x, y)`,
      params: isParametric
        ? Object.keys(
            (
              allTransformVariations[
                vKey as keyof typeof allTransformVariations
              ] as { paramDefaults: Record<string, number> }
            )?.paramDefaults || {},
          ).map((pKey) => ({
            name: pKey,
            description: `Parameter ${pKey} for the transformation.`,
            range: 'Dynamic',
            type: 'float',
          }))
        : undefined,
    }
  })

  // Selected variation code snippet
  const currentCodeSnippet = createMemo(() => {
    const vKey = selectedVar()
    const variationObj =
      allTransformVariations[vKey as keyof typeof allTransformVariations]
    if (!variationObj) return '// Implementation code unavailable.'

    // Try to get actual implementation code string
    const fnStr = variationObj.fn ? String(variationObj.fn) : ''

    // Curated stylized TS code mappings for prominent variations
    if (vKey === 'linearVar') {
      return `// 2D Linear Variation\nexport const linearVar = simpleVariation(\n  'linearVar',\n  (pos, varInfo) => {\n    'use gpu'\n    return vec2f(pos).mul(varInfo.weight);\n  }\n);`
    } else if (vKey === 'swirlVar') {
      return `// 2D Swirl Variation\nexport const swirlVar = simpleVariation(\n  'swirlVar',\n  (pos, varInfo) => {\n    'use gpu'\n    let r2 = pos.x * pos.x + pos.y * pos.y;\n    let r = sqrt(r2);\n    let theta = atan2(pos.y, pos.x) + varInfo.weight * r;\n    return vec2f(r * cos(theta), r * sin(theta));\n  }\n);`
    } else if (vKey === 'sphericalVar') {
      return `// 2D Spherical Variation\nexport const sphericalVar = simpleVariation(\n  'sphericalVar',\n  (pos, varInfo) => {\n    'use gpu'\n    let r2 = pos.x * pos.x + pos.y * pos.y;\n    return pos.mul(varInfo.weight / max(r2, 1e-4));\n  }\n);`
    } else if (vKey === 'atanVar') {
      return `// 2D Arctangent (Parametric) Variation\nconst AtanVarParams = struct({ mode: f32, stretch: f32 });\n\nexport const atanVar = parametricVariation(\n  'atanVar',\n  AtanVarParams,\n  AtanVarParamsDefaults,\n  AtanVarParamsEditor,\n  (pos, varInfo, P) => {\n    'use gpu'\n    let norm = 2.0 / PI;\n    if (P.mode < 0.5) {\n      return vec2f(pos.x, norm * atan(P.stretch * pos.y)).mul(varInfo.weight);\n    } else if (P.mode < 1.5) {\n      return vec2f(norm * atan(P.stretch * pos.x), pos.y).mul(varInfo.weight);\n    }\n    return vec2f(\n      norm * atan(P.stretch * pos.x),\n      norm * atan(P.stretch * pos.y)\n    ).mul(varInfo.weight);\n  }\n);`
    }

    if (fnStr) {
      return `// Compiled TypeGPU function\n// Name: ${getNormalizedVariationName(vKey)}\n\n${fnStr.substring(0, 400)}${fnStr.length > 400 ? '\n// ... [truncated]' : ''}`
    }

    return `// Code representation for: ${getNormalizedVariationName(vKey)}\n// Category: ${variationObj.category || 'general'}`
  })

  // Get preview flame descriptor
  const getFlameForVar = (name: string) => {
    return dimension() === 3
      ? getVariationPreviewFlame3D(
          name as Parameters<typeof getVariationPreviewFlame3D>[0],
        )
      : getVariationPreviewFlame(name)
  }

  // Math Rendering helper
  const renderedMathSvg = createMemo(() => {
    if (!mathJaxLoaded()) return null
    const math = currentDoc().math
    return renderTexToSvg(math, true)
  })

  return (
    <div class={ui.docModal} data-theme={theme()}>
      {/* Header */}
      <header class={ui.header}>
        <h2 class={ui.title}>Documentation</h2>
        <div class={ui.tabs}>
          <button
            class={ui.tabBtn}
            classList={{ [ui.tabBtnActive!]: activeTab() === 'variations' }}
            onClick={() => setActiveTab('variations')}
          >
            Variations
          </button>
          <button
            class={ui.tabBtn}
            classList={{ [ui.tabBtnActive!]: activeTab() === 'ifs' }}
            onClick={() => setActiveTab('ifs')}
          >
            IFS Math
          </button>
          <button
            class={ui.tabBtn}
            classList={{ [ui.tabBtnActive!]: activeTab() === 'api' }}
            onClick={() => setActiveTab('api')}
          >
            API Reference
          </button>
        </div>
        <button class={ui.closeBtn} onClick={props.respond} title="Close">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path
              fill="currentColor"
              d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"
            />
          </svg>
        </button>
      </header>

      {/* Main Content Area */}
      <div class={ui.content}>
        <Show when={activeTab() === 'variations'}>
          <div class={ui.splitLayout}>
            {/* Left Column: List/Search */}
            <div class={ui.leftPanel}>
              <div class={ui.searchBar}>
                <input
                  type="text"
                  class={ui.searchInput}
                  placeholder="Search variations..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
                <div class={ui.toggleGroup}>
                  <button
                    class={ui.toggleBtn}
                    classList={{ [ui.toggleBtnActive!]: dimension() === 2 }}
                    onClick={() => {
                      setDimension(2)
                      setSelectedVar(variationTypes[0] || 'linearVar')
                    }}
                  >
                    2D
                  </button>
                  <button
                    class={ui.toggleBtn}
                    classList={{ [ui.toggleBtnActive!]: dimension() === 3 }}
                    onClick={() => {
                      setDimension(3)
                      setSelectedVar(variationTypes3D[0] || 'linear3D')
                    }}
                  >
                    3D
                  </button>
                </div>
              </div>

              <div class={ui.listScroll} onScroll={(e) => {
                const target = e.currentTarget;
                if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
                  setVisibleCount(c => Math.min(c + 20, filteredVariations().length))
                }
              }}>
                <Root adapterOptions={{ powerPreference: 'high-performance' }}>
                  <ComputeGate capacity={COMPUTE_GATE_CAPACITY}>
                    <For each={visibleVariations()}>
                      {(vKey) => (
                        <button
                          class={ui.itemRow}
                          classList={{
                            [ui.itemRowActive!]: selectedVar() === vKey,
                          }}
                          onClick={() => setSelectedVar(vKey)}
                        >
                          <div class={ui.previewContainer}>
                            <VariationPreview
                              version={1}
                              isSelected={selectedVar() === vKey}
                              flame={getFlameForVar(vKey)}
                              name={vKey}
                              hardwareTier={null}
                              resolution={{ width: 48, height: 32 }}
                            />
                          </div>
                          <span class={ui.itemName}>
                            {getNormalizedVariationName(vKey)}
                          </span>
                        </button>
                      )}
                    </For>
                  </ComputeGate>
                </Root>
              </div>
            </div>

            {/* Right Column: Selected Info */}
            <div class={ui.rightPanel}>
              <div class={ui.variationHeader}>
                <h3 class={ui.variationName}>{currentDoc().name}</h3>
                <div class={ui.metaRow}>
                  <span class={ui.badge}>{dimension()}D</span>
                  <span class={ui.badge}>
                    {currentDoc().params ? 'Parametric' : 'Simple'}
                  </span>
                  <span class={ui.badge}>
                    Category:{' '}
                    {allTransformVariations[
                      selectedVar() as keyof typeof allTransformVariations
                    ]?.category || 'general'}
                  </span>
                </div>
              </div>

              <p class={ui.descriptionText}>{currentDoc().description}</p>

              {/* Math / Code sub-tabs */}
              <div class={ui.codeViewerContainer}>
                <div class={ui.subTabs}>
                  <button
                    class={ui.subTabBtn}
                    classList={{
                      [ui.subTabBtnActive!]: activeCodeTab() === 'math',
                    }}
                    onClick={() => setActiveCodeTab('math')}
                  >
                    Mathematical Formula
                  </button>
                  <button
                    class={ui.subTabBtn}
                    classList={{
                      [ui.subTabBtnActive!]: activeCodeTab() === 'code',
                    }}
                    onClick={() => setActiveCodeTab('code')}
                  >
                    TypeGPU Code
                  </button>
                </div>

                <div class={ui.tabContent}>
                  <Show when={activeCodeTab() === 'math'}>
                    <Show
                      when={mathJaxLoaded()}
                      fallback={
                        <span class={ui.rightPanelEmpty}>
                          {mathJaxError()
                            ? `Failed to load math renderer: ${mathJaxError()}`
                            : 'Loading math renderer...'}
                        </span>
                      }
                    >
                      <div
                        class={ui.mathRender}
                        innerHTML={renderedMathSvg() || ''}
                      />
                    </Show>
                  </Show>
                  <Show when={activeCodeTab() === 'code'}>
                    <pre class={ui.codePre}>
                      <code>{currentCodeSnippet()}</code>
                    </pre>
                  </Show>
                </div>
              </div>

              {/* Parameters List */}
              <Show when={currentDoc().params}>
                <div class={ui.paramsSection}>
                  <h4 class={ui.sectionTitle}>Parameters Overview</h4>
                  <table class={ui.paramsTable}>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Type</th>
                        <th>Range</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={currentDoc().params}>
                        {(param) => (
                          <tr>
                            <td class={ui.paramName}>{param.name}</td>
                            <td class={ui.paramType}>{param.type}</td>
                            <td>{param.range}</td>
                            <td>{param.description}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={activeTab() === 'ifs'}>
          <div class={ui.staticDoc}>
            <h3 class={ui.docTitle}>Iterated Function Systems (IFS)</h3>
            <p>
              An <strong>Iterated Function System (IFS)</strong> is a method of
              constructing fractals using a finite set of contraction mappings.
              In Chaos Master, we evaluate these functions using
              high-performance parallel computing via <strong>WebGPU</strong>.
            </p>
            <p>
              The generation algorithm starts with a random point in space and
              repeatedly applies one of the transformation chains selected
              randomly based on their individual probabilities.
            </p>

            <h3>The Transformation Chain</h3>
            <p>
              For each selected transformation, the coordinate{' '}
              <StaticMath tex="v" display={false} loaded={mathJaxLoaded} />{' '}
              undergoes a series of operations in sequence:
            </p>
            <ol>
              <li>
                <strong>Pre-Affine Transformation:</strong>
                Transforms the point via rotation, scaling, and translation:
                <div class={ui.formulaBlock}>
                  <StaticMath
                    tex="v_{\text{affine}} = M_{\text{pre}} \cdot v + T_{\text{pre}}"
                    loaded={mathJaxLoaded}
                  />
                </div>
              </li>
              <li>
                <strong>Variation Evaluation:</strong>
                Applies the non-linear variations defined in this documentation
                modal:
                <div class={ui.formulaBlock}>
                  <StaticMath
                    tex="v_{\text{var}} = \sum_j w_j \cdot V_j(v_{\text{affine}})"
                    loaded={mathJaxLoaded}
                  />
                </div>
              </li>
              <li>
                <strong>Post-Affine Transformation:</strong>
                Optionally transforms the variation output before plotting:
                <div class={ui.formulaBlock}>
                  <StaticMath
                    tex="v_{\text{final}} = M_{\text{post}} \cdot v_{\text{var}} + T_{\text{post}}"
                    loaded={mathJaxLoaded}
                  />
                </div>
              </li>
            </ol>

            <h3>The Chaos Game Algorithm</h3>
            <p>
              By applying these functions millions of times and plotting the
              resulting coordinates, the fractal shape emerges. Density
              estimation, log-exposure scaling, and color grading are then
              applied to render the gorgeous visual output you see on the
              canvas.
            </p>
          </div>
        </Show>

        <Show when={activeTab() === 'api'}>
          <div class={ui.staticDoc}>
            <h3 class={ui.docTitle}>API & Custom Variations Reference</h3>
            <p>
              Chaos Master allows you to program custom mathematical variations
              using the <strong>Custom Variation Editor</strong>. Custom
              variations are written in a subset of JavaScript and transpiled
              into WebGPU Shading Language (WGSL) at runtime.
            </p>

            <h3>Environment Bindings</h3>
            <p>
              Within a custom variation body, the following variables are
              pre-defined:
            </p>
            <ul>
              <li>
                <code>pos</code>: A <code>vec2f</code> containing the current
                coordinate <code>(x, y)</code>.
              </li>
              <li>
                <code>varInfo</code>: A struct containing:
                <ul>
                  <li>
                    <code>varInfo.weight</code>: The overall weight/strength of
                    this variation in the transform.
                  </li>
                </ul>
              </li>
              <li>
                <code>PI</code>, <code>EPS</code>: Standard mathematical
                constants.
              </li>
            </ul>

            <h3>WGSL Example</h3>
            <pre>
              <code>{`  let r = length(pos);
  let theta = atan2(pos.y, pos.x);
  let ripple = sin(r * 8.0) * 0.5 + 0.5;
  let newR = r + ripple * 0.2 * varInfo.weight;
  return vec2f(newR * cos(theta), newR * sin(theta));`}</code>
            </pre>

            <h3>Supported Built-in Math Functions</h3>
            <p>
              You can call standard WGSL functions: <code>sin</code>,{' '}
              <code>cos</code>, <code>tan</code>, <code>asin</code>,{' '}
              <code>acos</code>, <code>atan</code>, <code>atan2</code>,{' '}
              <code>sinh</code>, <code>cosh</code>, <code>tanh</code>,{' '}
              <code>pow</code>, <code>exp</code>, <code>log</code>,{' '}
              <code>sqrt</code>, <code>abs</code>, <code>min</code>,{' '}
              <code>max</code>, <code>clamp</code>, <code>length</code>,{' '}
              <code>distance</code>, and <code>dot</code>.
            </p>
          </div>
        </Show>
      </div>
    </div>
  )
}

export function createShowDocumentation() {
  const requestModal = useRequestModal()

  async function showDocumentation() {
    await requestModal({
      class: ui.docModal,
      content: ({ respond }) => <DocumentationModal respond={respond} />,
    })
  }

  return showDocumentation
}
