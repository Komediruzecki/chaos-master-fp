import { VERSION } from '@/version'
import { DebugPanel } from '../Debug/DebugPanel'
import ui from './SoftwareVersion.module.css'

export function SoftwareVersion(props: {
  showHelp: () => void
  showDocs: () => void
}) {
  return (
    <div class={ui.versionContainer}>
      <DebugPanel />
      <button class={ui.docsPill} onClick={props.showDocs}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Docs
      </button>
      <button class={ui.aboutPill} onClick={props.showHelp}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        v{VERSION}
      </button>
    </div>
  )
}
