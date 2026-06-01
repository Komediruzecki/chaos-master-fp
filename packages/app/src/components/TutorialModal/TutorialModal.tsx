import { createSignal, For, onCleanup, Show } from 'solid-js'
import { Cross, SkipBack, SkipForward } from '@/icons'
import { renderMarkdown } from '@/utils/renderMarkdown'
import ui from './TutorialModal.module.css'

export interface TutorialPage {
  title: string
  content: string
}

interface TutorialModalProps {
  title: string
  pages: TutorialPage[]
  respond: () => void
}

export function TutorialModal(props: TutorialModalProps) {
  const [currentPage, setCurrentPage] = createSignal(0)
  const totalPages = () => props.pages.length
  const isFirstPage = () => currentPage() === 0
  const isLastPage = () => currentPage() >= totalPages() - 1

  function goNext() {
    if (!isLastPage()) setCurrentPage((p) => p + 1)
  }

  function goPrev() {
    if (!isFirstPage()) setCurrentPage((p) => p - 1)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goPrev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goNext()
    }
  }

  onCleanup(() => {
    // no-op cleanup
  })

  return (
    <div class={ui.root} onKeyDown={onKeyDown}>
      <div class={ui.header}>
        <h1 class={ui.title}>{props.title}</h1>
        <button
          class={ui.closeBtn}
          onClick={() => {
            props.respond()
          }}
          title="Close"
        >
          <Cross width="0.875rem" />
        </button>
      </div>

      <div class={ui.content}>
        <Show
          when={props.pages[currentPage()]}
          keyed
          fallback={<p>No content</p>}
        >
          {(page) => (
            <>
              <h2 class={ui.pageTitle}>{page.title}</h2>
              <div
                class={ui.markdownBody}
                innerHTML={renderMarkdown(page.content)}
              />
            </>
          )}
        </Show>
      </div>

      <div class={ui.nav}>
        <button
          class={ui.navButton}
          disabled={isFirstPage()}
          onClick={goPrev}
          title="Previous page (Left arrow)"
        >
          <SkipBack width="0.75rem" />
          Previous
        </button>

        <div class={ui.pageIndicator}>
          <For each={Array.from({ length: totalPages() })}>
            {(_, i) => (
              <span
                class={ui.dot}
                classList={{ [ui.dotActive as string]: i() === currentPage() }}
              />
            )}
          </For>
        </div>

        <button
          class={ui.navButton}
          disabled={isLastPage()}
          onClick={goNext}
          title={
            isLastPage() ? 'This is the last page' : 'Next page (Right arrow)'
          }
        >
          {isLastPage() ? 'Finish' : 'Next'}
          <SkipForward width="0.75rem" />
        </button>
      </div>
    </div>
  )
}
