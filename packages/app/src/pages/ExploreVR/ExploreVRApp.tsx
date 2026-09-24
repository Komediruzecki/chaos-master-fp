/** Standalone entry for the desktop flame atlas, without mounting the editor. */
import { ErrorBoundary } from 'solid-js'
import { ExploreVRPage } from './ExploreVRPage'
import ui from './ExploreVRPage.module.css'

export function ExploreVRApp() {
  return (
    <ErrorBoundary
      fallback={
        <main class={ui.failure}>
          <h1>The atlas could not open</h1>
          <p>Reload this page to try again, or return to the studio.</p>
          <a href="/">Return to studio</a>
        </main>
      }
    >
      <ExploreVRPage />
    </ErrorBoundary>
  )
}
