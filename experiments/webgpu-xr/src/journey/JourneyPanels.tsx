// Folio overlays connect the two playable worlds without replacing their live scene.
import './journey.css'
import { createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js'
import { ALMANAC_WORLDS } from '../almanac/catalog'
import type { JSX } from 'solid-js'
import type { JourneyPersistence, JourneyProgress, JourneyWorldId, } from './progress'

const WORLD_IDS: readonly JourneyWorldId[] = ['glasswake', 'tideweave']
const worldFor = (id: JourneyWorldId) =>
  ALMANAC_WORLDS.find((world) => world.id === id)!
const recordedWorld = (progress: JourneyProgress, id: JourneyWorldId) =>
  progress.worlds[id].completion ?? worldFor(id)
const activityFor = (id: JourneyWorldId) =>
  id === 'glasswake' ? 'Opened three seals' : 'Traced four notes'

export function journeyPageStatus(
  progress: JourneyProgress,
  id: JourneyWorldId,
) {
  return progress.worlds[id].completion
    ? 'earned'
    : progress.worlds[id].discovered
      ? 'discovered'
      : 'undiscovered'
}

export function JourneySaveStatus(props: { persistence: JourneyPersistence }) {
  const message = createMemo(() => {
    if (props.persistence.status === 'protected')
      return props.persistence.reason === 'unsupported-version'
        ? 'This browser has an unsupported Almanac save version. It is being kept untouched. This visit will not replace it.'
        : 'The saved Almanac could not be read. It is being kept untouched. This visit will not replace it.'
    if (props.persistence.status === 'memory')
      return 'Earned pages are kept for this visit. Browser storage is unavailable, so they may be lost when you leave.'
    return props.persistence.status === 'saved'
      ? 'Almanac saved in this browser.'
      : 'Completed pages will be saved in this browser.'
  })
  return (
    <p
      class="journey-save-status"
      data-save-status={props.persistence.status}
      role="status"
    >
      {message()}
    </p>
  )
}

function FolioDialog(props: {
  panel: 'intro' | 'almanac' | 'receipt'
  title: string
  closeLabel: string
  onClose: () => void
  children: JSX.Element
}) {
  let dialog!: HTMLDialogElement
  onMount(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined
    dialog.showModal()
    onCleanup(() => {
      dialog.close()
      queueMicrotask(() => {
        if (previous?.isConnected && !document.querySelector('dialog[open]'))
          previous.focus({ preventScroll: true })
      })
    })
  })
  return (
    <dialog
      ref={dialog}
      class="journey-dialog"
      data-panel={props.panel}
      aria-labelledby={`journey-${props.panel}-title`}
      onCancel={(event) => {
        event.preventDefault()
        props.onClose()
      }}
    >
      <header class="journey-dialog-heading">
        <div>
          <span class="journey-location">Irchiinnuss</span>
          <h2 id={`journey-${props.panel}-title`}>{props.title}</h2>
        </div>
        <button
          class="journey-button journey-dismiss"
          type="button"
          onClick={props.onClose}
        >
          {props.closeLabel}
        </button>
      </header>
      {props.children}
    </dialog>
  )
}

export function JourneyIntro(props: {
  ready: boolean
  onClose: () => void
  onBegin: (world: JourneyWorldId) => void
  onHearNote: () => void
  onPracticeNote: (midi: number | null) => void
  audioStatus?: string
}) {
  const [practiceMidi, setPracticeMidi] = createSignal(64)
  let activePointer: number | undefined
  const stop = () => {
    activePointer = undefined
    props.onPracticeNote(null)
  }
  onMount(() => {
    window.addEventListener('blur', stop)
    const hidden = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', hidden)
    onCleanup(() => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', hidden)
      stop()
    })
  })
  return (
    <FolioDialog
      panel="intro"
      title="Two worlds. Two unfinished pages."
      closeLabel="Skip introduction"
      onClose={props.onClose}
    >
      <p class="journey-lead">
        You are an explorer in Irchiinnuss. Restore a glass form and grow a
        melody crossing. Each encounter leaves a page in your Almanac.
      </p>
      <div class="journey-intro-layout">
        <section
          class="journey-practice"
          aria-labelledby="journey-practice-title"
        >
          <div class="journey-practice-copy">
            <h3 id="journey-practice-title">Try a note</h3>
            <p>
              Move the slider to raise or lower the pitch. Let go to stop. Arrow
              keys work too.
            </p>
            <button
              type="button"
              class="journey-button"
              onClick={props.onHearNote}
            >
              Hear note
            </button>
            <span class="journey-audio-status" role="status">
              {props.audioStatus ?? 'Sound starts when you choose.'}
            </span>
          </div>
          <div class="journey-practice-range">
            <span>Higher</span>
            <input
              type="range"
              min="60"
              max="72"
              step="1"
              value={practiceMidi()}
              aria-label="Practice note height"
              aria-valuetext={`${['C', 'C sharp', 'D', 'D sharp', 'E', 'F', 'F sharp', 'G', 'G sharp', 'A', 'A sharp', 'B'][practiceMidi() % 12]} ${Math.floor(practiceMidi() / 12) - 1}`}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return
                activePointer = event.pointerId
                event.currentTarget.setPointerCapture(event.pointerId)
                props.onPracticeNote(practiceMidi())
              }}
              onInput={(event) => {
                setPracticeMidi(event.currentTarget.valueAsNumber)
                props.onPracticeNote(practiceMidi())
              }}
              onPointerUp={(event) => {
                if (event.pointerId === activePointer) stop()
              }}
              onPointerCancel={stop}
              onLostPointerCapture={stop}
              onKeyUp={stop}
              onBlur={stop}
            />
            <span>Lower</span>
          </div>
        </section>
        <div class="journey-intro-worlds">
          <For each={WORLD_IDS}>
            {(id) => (
              <section class="journey-intro-world" data-world={id}>
                <h3>
                  {worldFor(id).name}
                  <span>
                    {worldFor(id).tonic} {worldFor(id).mode}
                  </span>
                </h3>
                <p>
                  {id === 'glasswake'
                    ? 'Hold a note until the crystal answers. Release it to open a seal.'
                    : 'Hear four notes, then trace their shape to grow a crossing.'}
                </p>
                <button
                  class="journey-button journey-button-primary"
                  type="button"
                  disabled={!props.ready}
                  onClick={() => {
                    props.onBegin(id)
                  }}
                >
                  Visit {worldFor(id).name}
                </button>
              </section>
            )}
          </For>
        </div>
      </div>
      <footer class="journey-dialog-footer">
        <p>
          Use a mouse, touch or keyboard. Retry whenever you like. No microphone
          needed.
        </p>
        <Show when={!props.ready}>
          <p role="status">Opening the worlds…</p>
        </Show>
      </footer>
    </FolioDialog>
  )
}

interface CollectionProps {
  progress: JourneyProgress
  persistence: JourneyPersistence
  onClose: () => void
  onVisit: (world: JourneyWorldId) => void
  onPlayMotif: (world: JourneyWorldId) => void
  playingWorldId?: JourneyWorldId | null
  onOpenEnding: () => void
}

function TempleInvitation(props: { onOpen: () => void }) {
  return (
    <section class="journey-temple-invitation" aria-label="The temple signal">
      <p>
        <strong>The two pages answer each other.</strong>Hear Glasswake and
        Tideweave meet in one passage, and follow their signal to the temple.
      </p>
      <button
        type="button"
        class="journey-button journey-button-primary"
        onClick={props.onOpen}
      >
        Open temple signal
      </button>
    </section>
  )
}

export function JourneyAlmanac(props: CollectionProps) {
  const earned = createMemo(
    () => WORLD_IDS.filter((id) => props.progress.worlds[id].completion).length,
  )
  return (
    <FolioDialog
      panel="almanac"
      title="Your Almanac"
      closeLabel="Close Almanac"
      onClose={props.onClose}
    >
      <p class="journey-lead">
        {earned() === 2
          ? 'Both musical forms are recorded. Their shared signal is ready to hear.'
          : 'Visit each world, hear its motif and complete its encounter to earn a page.'}
      </p>
      <div class="journey-pages">
        <For each={WORLD_IDS}>
          {(id) => (
            <article
              class="journey-page"
              data-world={id}
              data-status={journeyPageStatus(props.progress, id)}
            >
              <div class="journey-page-index">
                <span>{id === 'glasswake' ? 'I' : 'II'}</span>
                <span>
                  {journeyPageStatus(props.progress, id) === 'earned'
                    ? 'Page earned'
                    : journeyPageStatus(props.progress, id) === 'discovered'
                      ? 'World discovered'
                      : 'Not yet visited'}
                </span>
              </div>
              <h3>{recordedWorld(props.progress, id).name}</h3>
              <p class="journey-page-mode">
                {recordedWorld(props.progress, id).tonic}{' '}
                {recordedWorld(props.progress, id).mode}
              </p>
              <p class="journey-page-activity">
                {props.progress.worlds[id].completion
                  ? activityFor(id)
                  : id === 'glasswake'
                    ? 'Three seals waiting for a note.'
                    : 'Four notes waiting for a crossing.'}
              </p>
              <p class="journey-page-detail">
                {id === 'glasswake'
                  ? 'A glass motif in an open crown of light.'
                  : 'A reed motif among five curling fronds.'}
              </p>
              <div class="journey-page-actions">
                <button
                  class="journey-button"
                  type="button"
                  onClick={() => {
                    props.onPlayMotif(id)
                  }}
                >
                  {props.playingWorldId === id
                    ? 'Stop motif'
                    : `Play ${worldFor(id).name} motif`}
                </button>
                <button
                  class="journey-button journey-button-primary"
                  type="button"
                  onClick={() => {
                    props.onVisit(id)
                  }}
                >
                  Visit {worldFor(id).name}
                </button>
              </div>
            </article>
          )}
        </For>
      </div>
      <Show when={earned() === 2}>
        <TempleInvitation onOpen={props.onOpenEnding} />
      </Show>
      <footer class="journey-dialog-footer journey-collection-footer">
        <div>
          <p>{earned()} / 2 pages earned. Replaying keeps your pages.</p>
          <JourneySaveStatus persistence={props.persistence} />
        </div>
        <a class="journey-button" href="/almanac">
          Open the book
        </a>
      </footer>
    </FolioDialog>
  )
}

export function JourneyReceipt(
  props: CollectionProps & {
    worldId: JourneyWorldId
    onOpenAlmanac: () => void
  },
) {
  const world = createMemo(() => recordedWorld(props.progress, props.worldId))
  const other = createMemo<JourneyWorldId>(() =>
    props.worldId === 'glasswake' ? 'tideweave' : 'glasswake',
  )
  const both = createMemo(() =>
    WORLD_IDS.every((id) => props.progress.worlds[id].completion),
  )
  return (
    <FolioDialog
      panel="receipt"
      title={`${world().name} added to your Almanac`}
      closeLabel="Close page"
      onClose={props.onClose}
    >
      <div class="journey-receipt" data-world={props.worldId}>
        <p class="journey-receipt-activity">{activityFor(props.worldId)}</p>
        <p>
          {both()
            ? 'Two pages, two ways to shape a world. Both motifs are yours to replay.'
            : `One musical form restored. ${worldFor(other()).name} is waiting on the next page.`}
        </p>
        <p class="journey-page-mode">
          {world().tonic} {world().mode}
        </p>
        <button
          class="journey-button"
          type="button"
          onClick={() => {
            props.onPlayMotif(props.worldId)
          }}
        >
          {props.playingWorldId === props.worldId
            ? 'Stop motif'
            : `Play ${world().name} motif`}
        </button>
      </div>
      <div class="journey-receipt-actions">
        <button
          class="journey-button journey-button-primary"
          type="button"
          onClick={() => {
            props.onVisit(other())
          }}
        >
          Continue to {worldFor(other()).name}
        </button>
        <button
          class="journey-button"
          type="button"
          onClick={props.onOpenAlmanac}
        >
          Open Almanac
        </button>
      </div>
      <Show when={both()}>
        <TempleInvitation onOpen={props.onOpenEnding} />
      </Show>
      <footer class="journey-dialog-footer">
        <p>
          This records the encounter you completed. It is not a singing score.
        </p>
        <JourneySaveStatus persistence={props.persistence} />
      </footer>
    </FolioDialog>
  )
}
