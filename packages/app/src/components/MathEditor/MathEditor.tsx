import { defaultKeymap, history, historyKeymap, indentWithTab, } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { mathToWgsl } from '@/utils/mathToWgsl'
import { wgslTheme } from '../WgslEditor/theme'
import ui from './MathEditor.module.css'

interface MathEditorProps {
  mathText: string
  onChange: (math: string) => void
  onWgslChange: (wgsl: string) => void
}

interface MathJaxInstance {
  tex2svg: (tex: string) => Document
  startup?: {
    document?: unknown
    defaultReady?: () => void
    promise?: Promise<void>
    ready?: () => void
  }
  loader?: { load: (ids: string[]) => void }
  config?: { loader?: { load?: string[] } }
}

function getMathJax(): MathJaxInstance | undefined {
  return (window as { MathJax?: MathJaxInstance }).MathJax
}

let mathjaxReady: Promise<void> | null = null

function ensureMathJax(): Promise<void> {
  if (mathjaxReady) return mathjaxReady
  mathjaxReady = import('mathjax/tex-svg.js').then(() => {
    const mj = getMathJax()
    if (!mj) throw new Error('MathJax failed to initialize')
    if (!mj.startup?.document) {
      // MathJax 4: needs startup initialization
      return new Promise<void>((resolve) => {
        mj.startup = {
          ...mj.startup,
          ready() {
            mj.startup?.defaultReady?.()
            mj.startup?.promise
              ?.then(() => {
                resolve()
              })
              .catch(() => {})
          },
        }
        if (mj.loader) mj.loader.load(mj.config?.loader?.load ?? [])
        else resolve() // Already initialized
      })
    }
  })
  return mathjaxReady
}

export function MathEditor(props: MathEditorProps) {
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [renderedSvg, setRenderedSvg] = createSignal('')
  let editorRef: HTMLDivElement | undefined
  let previewRef: HTMLDivElement | undefined
  let view: EditorView | undefined
  let renderTimer: ReturnType<typeof setTimeout> | undefined
  let suppressOnChange = false

  onMount(() => {
    // Initialize MathJax
    setLoading(true)
    ensureMathJax()
      .then(() => {
        setLoading(false)
        scheduleRender(props.mathText)
      })
      .catch((e: unknown) => {
        setLoading(false)
        setError(
          `Math renderer unavailable: ${e instanceof Error ? e.message : String(e)}`,
        )
      })

    // Create CodeMirror editor
    if (!editorRef) return

    const extensions = [
      lineNumbers(),
      history(),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      wgslTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressOnChange) {
          const newText = update.state.doc.toString()
          if (newText !== props.mathText) {
            handleInput(newText)
          }
        }
      }),
    ]

    const state = EditorState.create({
      doc: props.mathText,
      extensions,
    })

    view = new EditorView({
      state,
      parent: editorRef,
    })
  })

  // External mathText changes (loadMathExample, etc.)
  createEffect(() => {
    const externalText = props.mathText
    const v = view
    if (!v) return

    const currentDoc = v.state.doc.toString()
    if (externalText !== currentDoc) {
      suppressOnChange = true
      v.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: externalText,
        },
        selection: {
          anchor: Math.min(v.state.selection.main.anchor, externalText.length),
          head: Math.min(v.state.selection.main.head, externalText.length),
        },
      })
      suppressOnChange = false
      handleInput(externalText)
    }
  })

  function scheduleRender(math: string) {
    clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      renderMath(math)
    }, 600)
  }

  function renderMath(math: string) {
    if (!math.trim()) {
      setRenderedSvg('')
      return
    }
    const mj = getMathJax()
    if (!mj?.startup?.document) {
      setError('MathJax not ready')
      return
    }
    try {
      const displayMath = `\\displaystyle{${math}}`
      const svg = mj.tex2svg(displayMath)
      const svgEl = svg.querySelector('svg')
      if (svgEl) {
        setRenderedSvg(svgEl.outerHTML)
        setError(null)
      }
    } catch (e: unknown) {
      setError(`Render error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function handleInput(value: string) {
    props.onChange(value)
    scheduleRender(value)

    const result = mathToWgsl(value)
    if (result.errors.length > 0) {
      setError(result.errors.join('; '))
    } else {
      setError(null)
    }
    if (result.wgsl) {
      props.onWgslChange(result.wgsl)
    }
  }

  onCleanup(() => {
    clearTimeout(renderTimer)
    view?.destroy()
    view = undefined
  })

  return (
    <div class={ui.root}>
      <div class={ui.editorWrapper} ref={editorRef} />
      <div class={ui.previewPanel}>
        <div class={ui.previewLabel}>Rendered</div>
        <div class={ui.previewContent}>
          <Show when={loading()}>
            <div class={ui.statusMsg}>Loading MathJAX...</div>
          </Show>
          <Show when={!loading() && error()}>
            <div class={ui.errorMsg}>{error()}</div>
          </Show>
          <Show when={!loading() && !error() && renderedSvg()}>
            <div
              ref={previewRef}
              class={ui.mathRender}
              innerHTML={renderedSvg()}
            />
          </Show>
          <Show when={!loading() && !error() && !renderedSvg()}>
            <div class={ui.statusMsg}>Enter math to see preview</div>
          </Show>
        </div>
      </div>
    </div>
  )
}
