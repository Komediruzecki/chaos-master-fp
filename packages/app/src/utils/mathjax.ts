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
    const existing = getMathJax()
    if (existing) {
      if (existing.startup?.document) {
        resolve()
      } else {
        if (existing.startup?.promise) {
          existing.startup.promise.then(resolve).catch(() => {
            resolve()
          })
        } else {
          resolve()
        }
      }
      return
    }

    ;(window as { MathJax?: unknown }).MathJax = {
      startup: {
        typeset: false,
        ready() {
          const mj = getMathJax()!
          mj.startup?.defaultReady?.()
          if (mj.startup?.promise) {
            mj.startup.promise.then(resolve).catch(() => {
              resolve()
            })
          } else {
            resolve()
          }
        },
      },
    }

    import('mathjax/tex-svg.js')
      .then(() => {
        if (!getMathJax()) reject(new Error('MathJax failed to initialize'))
      })
      .catch((err) => {
        reject(
          new Error(
            `Failed to load MathJax script: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      })
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
