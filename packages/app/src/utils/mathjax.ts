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

export function getMathJax(): MathJaxInstance | undefined {
  return (window as { MathJax?: MathJaxInstance }).MathJax
}

let mathjaxReady: Promise<void> | null = null

export function ensureMathJax(): Promise<void> {
  if (mathjaxReady) return mathjaxReady

  mathjaxReady = new Promise<void>((resolve, reject) => {
    if (getMathJax()) {
      initMj(resolve)
      return
    }

    if (!getMathJax()) {
      ;(window as any).MathJax = {
        startup: { typeset: false },
      }
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js'
    script.async = true
    script.onload = () => {
      if (!getMathJax()) reject(new Error('MathJax failed to initialize'))
      else initMj(resolve)
    }
    script.onerror = () => reject(new Error('Failed to load MathJax script'))
    document.head.appendChild(script)

    function initMj(done: () => void) {
      const mj = getMathJax()!
      if (!mj.startup?.document) {
        mj.startup = {
          ...mj.startup,
          ready() {
            mj.startup?.defaultReady?.()
            mj.startup?.promise?.then(done).catch(() => {})
          },
        }
        if (mj.loader) mj.loader.load(mj.config?.loader?.load ?? [])
        else done()
      } else {
        done()
      }
    }
  })

  return mathjaxReady
}

export function renderTexToSvg(tex: string, display = true): string | null {
  const mj = getMathJax()
  if (!mj?.startup?.document) return null
  try {
    const wrapped = display ? `\\displaystyle{${tex}}` : tex
    const doc = mj.tex2svg(wrapped)
    const svg = doc.querySelector('svg')
    return svg ? svg.outerHTML : null
  } catch {
    return null
  }
}
