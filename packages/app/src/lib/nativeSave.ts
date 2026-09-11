import type { ToastAction } from '@/contexts/ToastContext'

/**
 * The native half of `downloadBlob` (utils/blob.ts). A WebView does nothing
 * with `<a download>`, so the native app hands the file to
 * @chaos-master/mobile-runtime instead: Android writes it to
 * Documents/Lumen Apeiron, iOS opens the share sheet. Only reached when
 * IS_NATIVE, and the runtime arrives through a dynamic import that web builds
 * drop (see loadRuntime), so the web bundle never carries the plugins.
 */

type Notify = (message: string, actions?: ToastAction[]) => void

let notify: Notify | null = null

/** components/NativeSaveToasts points this at the toast column. */
export function setSaveNotifier(next: Notify | null): void {
  notify = next
}

/** The folder inside Documents: the app's name, as the Files app lists it. */
const FOLDER = 'Lumen Apeiron'

// Vite's `define` turns this into a literal in each module. The import below
// is guarded by it rather than by the imported IS_NATIVE: the bundler does not
// fold constants across modules, and behind IS_NATIVE the web build still
// emitted the Capacitor chunk (never fetched, but it has no business there).
declare const __NATIVE_BUILD__: boolean

function loadRuntime() {
  if (__NATIVE_BUILD__) return import('@chaos-master/mobile-runtime/capacitor')
  return Promise.reject(
    new Error('The native runtime is only in the native build'),
  )
}

export async function saveNative(blob: Blob, filename: string): Promise<void> {
  try {
    const runtime = await loadRuntime()
    const outcome = await runtime.saveFile(blob, filename, { folder: FOLDER })
    // The share sheet was its own confirmation (or the user closed it).
    if (outcome.kind !== 'saved') return
    notify?.(`Saved ${outcome.fileName} to ${outcome.location}`, [
      {
        label: 'Share',
        onClick: () => {
          runtime
            .shareSavedFile(outcome.uri, outcome.fileName)
            .catch((error: unknown) => {
              console.error('Sharing the saved file failed:', error)
            })
        },
      },
    ])
  } catch (error) {
    console.error('Saving the file failed:', error)
    notify?.(`Could not save ${filename}`)
  }
}
