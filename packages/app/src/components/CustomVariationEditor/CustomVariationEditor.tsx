import { createMemo, createSignal, For, onCleanup, Show, untrack, } from 'solid-js'
import { vec2f, vec4f } from 'typegpu/data'
import { defineExample } from '@/flame/examples/util'
import { Flam3 } from '@/flame/Flam3'
import { generateTransformId, generateVariationId, } from '@/flame/transformFunction'
import { createCustomVariation, deleteCustomVariation, duplicateCustomVariation, getCustomVariations, previewCustomVariation, updateCustomVariation, } from '@/flame/variations/custom'
import { Cross, Plus, Sparkle, Terminal } from '@/icons'
import { AutoCanvas } from '@/lib/AutoCanvas'
import { Root } from '@/lib/Root'
import { WheelZoomCamera2D } from '@/lib/WheelZoomCamera2D'
import { useRequestModal } from '../Modal/ModalContext'
import { ModalTitleBar } from '../Modal/ModalTitleBar'
import ui from './CustomVariationEditor.module.css'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'
import type { CustomVariationDef } from '@/flame/variations/custom'

const CANCEL = 'cancel' as const
type RespondType = typeof CANCEL | { def: CustomVariationDef }

// ---- WGSL syntax highlighting ----

const WGSL_KEYWORDS = new Set([
  'let',
  'var',
  'return',
  'if',
  'else',
  'for',
  'while',
  'fn',
  'struct',
  'select',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'const',
  'discard',
  'loop',
  'continuing',
])

const WGSL_TYPES = new Set([
  'vec2f',
  'vec3f',
  'vec4f',
  'vec2i',
  'vec3i',
  'vec4i',
  'vec2u',
  'vec3u',
  'vec4u',
  'f32',
  'i32',
  'u32',
  'bool',
  'mat2x2f',
  'mat2x3f',
  'mat2x4f',
  'mat3x2f',
  'mat3x3f',
  'mat3x4f',
  'mat4x2f',
  'mat4x3f',
  'mat4x4f',
  'array',
  'ptr',
  'texture_1d',
  'texture_2d',
  'texture_3d',
  'texture_cube',
  'sampler',
  'Sampler',
  'atomic',
])

const BUILTINS = new Set([
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atanh',
  'atan2',
  'ceil',
  'clamp',
  'cos',
  'cosh',
  'cross',
  'degrees',
  'determinant',
  'distance',
  'dot',
  'exp',
  'exp2',
  'faceForward',
  'floor',
  'fma',
  'fract',
  'frexp',
  'inverseSqrt',
  'ldexp',
  'length',
  'log',
  'log2',
  'max',
  'min',
  'mix',
  'modf',
  'normalize',
  'pow',
  'quantizeToF16',
  'radians',
  'reflect',
  'refract',
  'round',
  'sign',
  'sin',
  'sinh',
  'saturate',
  'smoothstep',
  'sqrt',
  'step',
  'tan',
  'tanh',
  'transpose',
  'trunc',
  'dpdx',
  'dpdy',
  'fwidth',
  'pack4x8snorm',
  'pack4x8unorm',
  'pack2x16snorm',
  'pack2x16unorm',
  'pack2x16float',
  'unpack4x8snorm',
  'unpack4x8unorm',
  'unpack2x16snorm',
  'unpack2x16unorm',
  'unpack2x16float',
  'all',
  'any',
  'countLeadingZeros',
  'countOneBits',
  'countTrailingZeros',
  'extractBits',
  'firstLeadingBit',
  'firstTrailingBit',
  'insertBits',
  'reverseBits',
  'mod',
  'floorMod',
])

function tokenizeWgsl(code: string): string {
  const lines = code.split('\n')
  return lines
    .map((line, i) => {
      let highlighted = ''
      let col = 0
      while (col < line.length) {
        // Comments
        if (line[col] === '/' && line[col + 1] === '/') {
          highlighted += `<span class="comment">${esc(line.slice(col))}</span>`
          break
        }
        // Strings
        if (line[col] === '"') {
          const end = line.indexOf('"', col + 1)
          if (end !== -1) {
            highlighted += `<span class="string">${esc(
              line.slice(col, end + 1),
            )}</span>`
            col = end + 1
            continue
          }
        }
        // Numbers
        const numMatch = line
          .slice(col)
          .match(/^(\d+\.?\d*(?:[eE][+-]?\d+)?[fiu]?|0x[\da-fA-F]+[u]?)/)
        if (numMatch && numMatch[1] !== undefined) {
          highlighted += `<span class="number">${numMatch[1]}</span>`
          col += numMatch[1].length
          continue
        }
        // Identifiers
        const identMatch = line.slice(col).match(/^([a-zA-Z_]\w*)/)
        if (identMatch && identMatch[1] !== undefined) {
          const word = identMatch[1]
          if (WGSL_KEYWORDS.has(word)) {
            highlighted += `<span class="keyword">${word}</span>`
          } else if (WGSL_TYPES.has(word)) {
            highlighted += `<span class="type">${word}</span>`
          } else if (BUILTINS.has(word)) {
            highlighted += `<span class="builtin">${word}</span>`
          } else {
            highlighted += esc(word)
          }
          col += word.length
          continue
        }
        // Operators / punctuation
        const char = line[col]
        if (char !== undefined) {
          highlighted += esc(char)
        }
        col++
      }
      return `<span class="ln">${i + 1}</span>${highlighted || ' '}\n`
    })
    .join('')
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const PREVIEW_VARIATION_ID = generateVariationId()
const PREVIEW_TRANSFORM_ID = generateTransformId('custom_preview')

const EXAMPLE_VARIATIONS = [
  {
    name: 'Polar Ripple',
    wgsl: `  let r = length(pos);
  let theta = atan2(pos.y, pos.x);
  let ripple = sin(r * 8.0) * 0.5 + 0.5;
  let newR = r + ripple * 0.2 * varInfo.weight;
  return vec2f(newR * cos(theta), newR * sin(theta));`,
  },
  {
    name: 'Julia Nega',
    wgsl: `  let r = sqrt(length(pos));
  let theta = atan2(pos.y, pos.x);
  let omega = select(0.0, 3.14159265, theta < 0.0);
  let newTheta = theta * 0.5 + omega;
  let negR = -r;
  return vec2f(negR * cos(newTheta), negR * sin(newTheta));`,
  },
]

function makePreviewFlame(variationType: string): FlameDescriptor {
  return defineExample({
    renderSettings: {
      exposure: 0.3,
      skipIters: 1,
      drawMode: 'light',
      backgroundColor: [0, 0, 0],
      camera: { zoom: 1, position: [0, 0] },
      colorInitMode: 'colorInitPosition',
      pointInitMode: 'pointInitUnitDisk',
    },
    transforms: {
      [PREVIEW_TRANSFORM_ID]: {
        probability: 1,
        preAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        postAffine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        color: { x: 0, y: 0 },
        variations: {
          [PREVIEW_VARIATION_ID]: {
            type: variationType,
            weight: 1,
            visible: true,
          },
        },
      },
    },
  })
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'compiling' }
  | { status: 'error'; errors: string[] }
  | { status: 'compiled'; id: string; unregister: () => void }

type SaveResult =
  | { success: true; def: CustomVariationDef }
  | { success: false; errors: string[] }

function ShowCustomVariationEditor(props: {
  respond: (value: RespondType) => void
}) {
  const [activeId, setActiveId] = createSignal<string | undefined>()
  const [code, setCode] = createSignal('')
  const [name, setName] = createSignal('Untitled')
  const [variations, setVariations] = createSignal<CustomVariationDef[]>(
    getCustomVariations(),
  )
  const [preview, setPreview] = createSignal<PreviewState>({ status: 'idle' })
  const [previewKey, setPreviewKey] = createSignal(0)
  const [savedDef, setSavedDef] = createSignal<CustomVariationDef | undefined>()

  let textareaRef: HTMLTextAreaElement | undefined
  let highlightRef: HTMLPreElement | undefined
  let lineNumbersRef: HTMLDivElement | undefined

  const activeVariation = createMemo(() => {
    const id = activeId()
    if (!id) return
    return variations().find((v) => v.id === id)
  })

  const isDirty = createMemo(() => {
    const av = activeVariation()
    if (!av) return code() !== '' || name() !== 'Untitled'
    return av.wgsl !== code() || av.name !== name()
  })

  const canSave = createMemo(() => {
    const p = preview()
    return p.status === 'compiled' && isDirty()
  })

  const previewVariationType = createMemo(() => {
    const p = preview()
    if (p.status === 'compiled') return p.id
    return 'linear'
  })

  const previewFlame = createMemo(() => {
    void previewKey()
    const id = previewVariationType()
    return makePreviewFlame(id)
  })

  function loadVariation(def: CustomVariationDef) {
    // Clean up any existing preview
    const p = untrack(preview)
    if (p.status === 'compiled') p.unregister()
    setActiveId(def.id)
    setName(def.name)
    setCode(def.wgsl)
    setPreview({ status: 'idle' })
    setPreviewKey((k) => k + 1)
    setSavedDef(def)
  }

  function createNew() {
    const p = untrack(preview)
    if (p.status === 'compiled') p.unregister()
    setActiveId(undefined)
    setName('Untitled')
    setCode('')
    setPreview({ status: 'idle' })
    setPreviewKey((k) => k + 1)
    setSavedDef(undefined)
  }

  function loadExample(exName: string, wgsl: string) {
    const p = untrack(preview)
    if (p.status === 'compiled') p.unregister()
    setActiveId(undefined)
    setName(exName)
    setCode(wgsl)
    setPreview({ status: 'idle' })
    setPreviewKey((k) => k + 1)
    setSavedDef(undefined)
  }

  function handleDelete(id: string) {
    deleteCustomVariation(id)
    setVariations(getCustomVariations())
    if (activeId() === id) {
      const p = untrack(preview)
      if (p.status === 'compiled') p.unregister()
      setActiveId(undefined)
      setCode('')
      setName('Untitled')
      setPreview({ status: 'idle' })
      setPreviewKey((k) => k + 1)
      setSavedDef(undefined)
    }
  }

  function handleDuplicate(id: string) {
    const result = duplicateCustomVariation(id)
    if (result.success) {
      setVariations(getCustomVariations())
      loadVariation(result.def)
    }
  }

  function handleCompile() {
    const body = code()
    if (!body.trim()) {
      const p = untrack(preview)
      if (p.status === 'compiled') p.unregister()
      setPreview({ status: 'idle' })
      return
    }

    setPreview({ status: 'compiling' })

    const result = previewCustomVariation(body)
    const p = untrack(preview)
    if (p.status === 'compiled') p.unregister()

    if (result.valid) {
      setPreview({
        status: 'compiled',
        id: result.id,
        unregister: result.unregister,
      })
      setPreviewKey((k) => k + 1)
    } else {
      setPreview({ status: 'error', errors: result.errors })
    }
  }

  function handleSave(): SaveResult {
    const body = code()
    const variationName = name()
    const existing = activeId()

    let result: SaveResult
    if (existing) {
      result = updateCustomVariation(existing, body, variationName)
    } else {
      result = createCustomVariation(variationName, body)
    }

    if (result.success) {
      setVariations(getCustomVariations())
      setActiveId(result.def.id)
      setSavedDef(result.def)
      // Re-establish preview with the real ID
      const p = untrack(preview)
      if (p.status === 'compiled') p.unregister()
      const newPreview = previewCustomVariation(body)
      if (newPreview.valid) {
        setPreview({
          status: 'compiled',
          id: newPreview.id,
          unregister: newPreview.unregister,
        })
        setPreviewKey((k) => k + 1)
      }
    }

    return result
  }

  function handleUse() {
    const def = savedDef()
    if (def) {
      props.respond({ def })
    }
  }

  // Scroll sync: textarea ↔ highlight ↔ line numbers
  function syncScroll() {
    if (!textareaRef || !highlightRef || !lineNumbersRef) return
    highlightRef.scrollTop = textareaRef.scrollTop
    highlightRef.scrollLeft = textareaRef.scrollLeft
    lineNumbersRef.scrollTop = textareaRef.scrollTop
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = code().slice(0, start)
      const after = code().slice(end)
      const spaces = '  '
      setCode(before + spaces + after)
      // Restore cursor after spaces
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const ta = textareaRef
      if (!ta) return
      const start = ta.selectionStart
      const lines = code().slice(0, start).split('\n')
      const currentLine = lines[lines.length - 1] ?? ''
      const indent = currentLine.match(/^(\s*)/)?.[1] ?? ''
      // Auto-indent: add 2 spaces after {
      const extra = currentLine.trimEnd().endsWith('{') ? '  ' : ''
      const insertion = `\n${indent}${extra}`
      const after = code().slice(ta.selectionEnd)
      setCode(code().slice(0, start) + insertion + after)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + insertion.length
      })
      return
    }
  }

  onCleanup(() => {
    const p = untrack(preview)
    if (p.status === 'compiled') p.unregister()
  })

  const highlighted = createMemo(() => {
    const c = code()
    if (!c) return '<span class="ln">1</span> '
    return tokenizeWgsl(c)
  })

  const lineCount = createMemo(() => {
    return code().split('\n').length
  })

  const statusText = createMemo(() => {
    const p = preview()
    switch (p.status) {
      case 'idle':
        return 'Ready'
      case 'compiling':
        return 'Compiling...'
      case 'error':
        return 'Error'
      case 'compiled':
        return 'Compiled'
    }
  })

  return (
    <div class={ui.root}>
      <ModalTitleBar
        onClose={() => {
          props.respond(CANCEL)
        }}
      >
        Custom Variation Editor
      </ModalTitleBar>

      <div class={ui.main}>
        {/* --- Sidebar --- */}
        <aside class={ui.sidebar}>
          <div class={ui.sidebarHeader}>
            <span class={ui.sidebarTitle}>Variations</span>
            <button
              class={ui.newButton}
              onClick={createNew}
              title="New variation"
            >
              <Plus width="0.875rem" />
            </button>
          </div>

          <Show
            when={variations().length > 0}
            fallback={
              <div class={ui.emptySidebar}>
                No custom variations yet. Click + to create one.
              </div>
            }
          >
            <For each={variations()}>
              {(v) => (
                <div
                  class={ui.variationItem}
                  classList={{
                    [ui.variationItemActive as string]: activeId() === v.id,
                  }}
                  onClick={() => {
                    loadVariation(v)
                  }}
                >
                  <Sparkle width="0.75rem" />
                  <span class={ui.variationName}>{v.name}</span>
                  <span class={ui.variationActions}>
                    <button
                      class={ui.iconButton}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDuplicate(v.id)
                      }}
                      title="Duplicate"
                    >
                      <Plus width="0.625rem" />
                    </button>
                    <button
                      class={`${ui.iconButton} ${ui.iconButtonDanger}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(v.id)
                      }}
                      title="Delete"
                    >
                      <Cross width="0.625rem" />
                    </button>
                  </span>
                </div>
              )}
            </For>
          </Show>

          <div class={ui.examplesSection}>
            <div class={ui.examplesTitle}>Examples</div>
            <For each={EXAMPLE_VARIATIONS}>
              {(ex) => (
                <button
                  class={ui.exampleButton}
                  onClick={() => {
                    loadExample(ex.name, ex.wgsl)
                  }}
                  title={`Load ${ex.name} example`}
                >
                  {ex.name}
                </button>
              )}
            </For>
          </div>
        </aside>

        {/* --- Editor --- */}
        <div class={ui.editorPanel}>
          <input
            class={ui.nameInput}
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Variation name"
          />

          <div class={ui.editorWrapper}>
            <div class={ui.lineNumbers} ref={lineNumbersRef}>
              <For each={Array.from({ length: lineCount() })}>
                {(_, i) => <div>{i() + 1}</div>}
              </For>
            </div>
            <pre
              class={ui.highlightLayer}
              ref={highlightRef}
              aria-hidden="true"
              innerHTML={highlighted()}
            />
            <textarea
              ref={textareaRef}
              class={ui.textarea}
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              onScroll={syncScroll}
              onKeyDown={handleKeyDown}
              spellcheck={false}
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              placeholder={`// Write your variation function body here.\n// The function signature is:\n//   (pos: vec2f, varInfo: VariationInfo) -> vec2f\n//\n// Available: all WGSL math builtins (sin, cos, length, normalize, etc.)\n//\n// Example:\n//   let r = length(pos);\n//   let theta = atan2(pos.y, pos.x);\n//   return vec2f(r * cos(theta + varInfo.weight), r * sin(theta + varInfo.weight));`}
            />
          </div>

          {/* --- Bottom bar --- */}
          <div class={ui.bottomBar}>
            <span
              classList={{
                [ui.statusIdle as string]: preview().status === 'idle',
                [ui.statusSuccess as string]: preview().status === 'compiled',
                [ui.statusError as string]: preview().status === 'error',
              }}
            >
              <Show when={preview().status === 'compiling'}>
                <Terminal width="0.75rem" />{' '}
              </Show>
              {statusText()}
            </span>

            <Show
              when={
                preview().status === 'error' &&
                (preview() as { status: 'error'; errors: string[] })
              }
            >
              {(p) => (
                <div class={ui.errorList}>
                  <For each={p().errors}>{(e) => <div>{e}</div>}</For>
                </div>
              )}
            </Show>

            <div style={{ flex: 1 }} />

            <button
              class={ui.newButton}
              style={{
                width: 'auto',
                padding: '0 var(--space-2)',
                'font-size': '0.75rem',
              }}
              onClick={handleCompile}
            >
              Compile &amp; Test
            </button>

            <button
              class={ui.newButton}
              style={{
                width: 'auto',
                padding: '0 var(--space-2)',
                'font-size': '0.75rem',
                opacity: canSave() ? 1 : 0.5,
              }}
              disabled={!canSave()}
              onClick={handleSave}
            >
              Save
            </button>

            <Show when={savedDef()}>
              <button
                class={ui.newButton}
                style={{
                  width: 'auto',
                  padding: '0 var(--space-2)',
                  'font-size': '0.75rem',
                  background: 'var(--blue-500)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={handleUse}
              >
                Use in Current Transform
              </button>
            </Show>
          </div>
        </div>

        {/* --- Preview --- */}
        <div class={ui.previewPanel}>
          <span class={ui.previewLabel}>Preview</span>
          <Show
            when={preview().status === 'compiled'}
            fallback={
              <div class={ui.previewPlaceholder}>
                {preview().status === 'compiling'
                  ? 'Compiling...'
                  : 'Compile to see preview'}
              </div>
            }
          >
            <div class={ui.previewCanvas}>
              <AutoCanvas pixelRatio={1}>
                <WheelZoomCamera2D
                  zoom={[() => 1, () => {}]}
                  position={[() => vec2f(), () => undefined]}
                >
                  <Flam3
                    animationEnabled={false}
                    quality={0.99}
                    pointCountPerBatch={50000}
                    adaptiveFilterEnabled={false}
                    flameDescriptor={previewFlame()}
                    renderInterval={1}
                    edgeFadeColor={vec4f(0)}
                  />
                </WheelZoomCamera2D>
              </AutoCanvas>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export function createShowCustomVariationEditor() {
  const requestModal = useRequestModal()
  const [isOpen, setIsOpen] = createSignal(false)

  async function showCustomVariationEditor(_existingDef?: CustomVariationDef) {
    setIsOpen(true)
    const result = await requestModal<RespondType>({
      class: ui.editorModal,
      content: ({ respond }) => (
        <Root adapterOptions={{ powerPreference: 'high-performance' }}>
          <ShowCustomVariationEditor respond={respond} />
        </Root>
      ),
    })
    setIsOpen(false)
    if (result === CANCEL) return
    return result.def
  }

  return { showCustomVariationEditor, customVariationEditorIsOpen: isOpen }
}
