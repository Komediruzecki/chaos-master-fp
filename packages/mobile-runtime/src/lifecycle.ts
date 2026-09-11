/**
 * What the app needs from the platform's lifecycle, and nothing more: the
 * Android back gesture, pause and resume, and a way to send the app to the
 * background. The web has no back button and no minimize; it still pauses,
 * through visibilitychange, so the draft save (app lib/draft.ts) behaves the
 * same in a browser tab.
 */
export interface LifecyclePorts {
  onBackButton(callback: () => void): () => void
  onPause(callback: () => void): () => void
  onResume(callback: () => void): () => void
  minimizeApp(): Promise<void>
}

export function webLifecycle(doc: Document = document): LifecyclePorts {
  const onVisibility = (wanted: boolean, callback: () => void) => {
    const listener = () => {
      if (doc.hidden === wanted) callback()
    }
    doc.addEventListener('visibilitychange', listener)
    return () => {
      doc.removeEventListener('visibilitychange', listener)
    }
  }
  return {
    onBackButton: () => () => {},
    onPause: (callback) => onVisibility(true, callback),
    onResume: (callback) => onVisibility(false, callback),
    minimizeApp: () => Promise.resolve(),
  }
}
