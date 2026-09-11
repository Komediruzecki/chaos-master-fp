/* @refresh reload */
import '../styles/index.css'
import { createEffect } from 'solid-js'
import { render } from 'solid-js/web'
import { gpuStatus } from '@/lib/gpuStatus'
import { HeadlessRender } from './HeadlessRender'

/**
 * Entry point for the headless render page.
 *
 * Everything here exists to make a failed render fail LOUDLY and EARLY. The
 * driver (workers/render-worker/tools/chrome-render.mjs) polls
 * `window.__renderError`, so every path that would otherwise leave the page
 * silently stuck — an uncaught throw, a rejected promise, a dead GPU device —
 * has to write that field instead of letting the driver burn its full timeout.
 */
type HeadlessWindow = Window & {
  __renderError?: string
  __gpuStatus?: string
}

const w = window as HeadlessWindow

/** First failure wins: later noise must not overwrite the root cause. */
function fail(message: string) {
  w.__renderError ??= message
}

window.addEventListener('error', (e) => {
  fail(`uncaught: ${e.message}`)
})
window.addEventListener('unhandledrejection', (e) => {
  fail(`unhandled rejection: ${String(e.reason)}`)
})

const root = document.getElementById('headless-root')
if (!root) throw new Error('missing #headless-root')

render(() => {
  createEffect(() => {
    const status = gpuStatus()
    w.__gpuStatus = status
    // These two are terminal for the session (reload-only recovery), so there
    // is nothing to wait for — tell the driver now.
    if (status === 'unavailable' || status === 'unsupported') {
      fail(`gpu ${status}`)
    }
  })
  return <HeadlessRender />
}, root)
