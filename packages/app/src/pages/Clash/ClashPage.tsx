/**
 * The Flame Clash preview page (`/clash`): two fighters, one scripted bout.
 *
 * A preview of the new clash, reachable only by its URL: nothing in the
 * editor links here, and nothing here touches the editor's document. The
 * fighters come from the URL (`?a=` and `?b=`, see clashFighters.ts) or the
 * picker, and default to a 3D flame against a 2D one so the flat-card entry
 * shows. `?winner=b` scripts the other outcome.
 */
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import { ClashStage } from '@/components/ClashStage/ClashStage'
import { usePrefersReducedMotion } from '@/components/Home/homePlayback'
import { clashFighter, unfitReason } from '@/flame/clash/fightFlame'
import { fetchGallery } from '@/lib/galleryContent'
import { persistentSignal } from '@/utils/persistentSignal'
import { loadRecentFlames } from '@/utils/recentFlames'
import { DEFAULT_FIGHTERS, exampleOptions, formatFighterRef, galleryOptions, loadFighter, parseFighterRef, recentOptions, } from './clashFighters'
import ui from './ClashPage.module.css'
import { clashQuality } from './clashQuality'
import type { FighterOption, FighterRef } from './clashFighters'
import type { Team } from '@/flame/clash/tint'
import type { HardwareTier } from '@/utils/hardwareTier'

type Refs = Record<'a' | 'b', FighterRef>

async function loadBout(refs: Refs) {
  const [a, b] = await Promise.all([loadFighter(refs.a), loadFighter(refs.b)])
  if (!a || !b) {
    return { error: `Fighter ${a ? 'B' : 'A'} could not be loaded.` }
  }
  for (const [side, fighter] of [
    ['A', a],
    ['B', b],
  ] as const) {
    const unfit = unfitReason(fighter.flame)
    if (unfit)
      return { error: `${fighter.name} (${side}) cannot fight: ${unfit}.` }
  }
  return {
    fighters: {
      a: clashFighter(a.flame, a.name),
      b: clashFighter(b.flame, b.name),
    },
  }
}

/** Keeps the preview out of search results. */
function markNoIndex() {
  if (document.head.querySelector('meta[name="robots"]')) return
  const meta = document.createElement('meta')
  meta.name = 'robots'
  meta.content = 'noindex'
  document.head.append(meta)
}

export function ClashPage() {
  const query = new URLSearchParams(window.location.search)
  const winner: Team = query.get('winner') === 'b' ? 'B' : 'A'
  const [refs, setRefs] = createSignal<Refs>({
    a: parseFighterRef(query.get('a')) ?? DEFAULT_FIGHTERS.a,
    b: parseFighterRef(query.get('b')) ?? DEFAULT_FIGHTERS.b,
  })
  const [bout] = createResource(refs, loadBout)
  const [picking, setPicking] = createSignal(false)

  const prefersReduced = usePrefersReducedMotion()
  const [reducedChoice, setReducedChoice] = createSignal<boolean>()
  const reducedMotion = () => reducedChoice() ?? prefersReduced()

  const [storedTier] = persistentSignal<HardwareTier | null>(
    'hardwareTier',
    null,
  )
  const quality = clashQuality(
    storedTier(),
    globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
  )

  onMount(markNoIndex)

  const fight = (next: Refs) => {
    setPicking(false)
    const url = new URL(window.location.href)
    url.searchParams.set('a', formatFighterRef(next.a))
    url.searchParams.set('b', formatFighterRef(next.b))
    window.history.replaceState(null, '', url)
    setRefs(next)
  }

  return (
    <main class={ui.page}>
      <Show when={bout()?.fighters} keyed>
        {(fighters) => (
          <ClashStage
            a={fighters.a}
            b={fighters.b}
            winner={winner}
            reducedMotion={reducedMotion()}
            renderScale={quality.renderScale}
            pointCountPerBatch={quality.pointCountPerBatch}
            onReducedMotionChange={setReducedChoice}
            onChangeFighters={() => setPicking(true)}
          />
        )}
      </Show>
      <Show when={bout.loading}>
        <p class={ui.status}>Loading the fighters...</p>
      </Show>
      <Show when={bout()?.error}>
        {(error) => <p class={ui.status}>{error()}</p>}
      </Show>
      <Show when={picking() || bout()?.error !== undefined}>
        <FighterPicker
          current={refs()}
          onFight={fight}
          onClose={() => setPicking(false)}
        />
      </Show>
    </main>
  )
}

type FighterPickerProps = {
  current: Refs
  onFight: (refs: Refs) => void
  onClose: () => void
}

function FighterPicker(props: FighterPickerProps) {
  const [gallery] = createResource(async () => {
    try {
      return galleryOptions(await fetchGallery())
    } catch {
      // No gallery on this deploy, or offline: offer the rest.
      return []
    }
  })
  const options = (): FighterOption[] => [
    ...recentOptions(loadRecentFlames()),
    ...exampleOptions(),
    ...(gallery() ?? []),
  ]
  const groups = () =>
    (['Your flames', 'Examples', 'Gallery'] as const)
      .map((group) => ({
        group,
        options: options().filter((o) => o.group === group),
      }))
      .filter((g) => g.options.length > 0)

  let form: HTMLFormElement | undefined
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    if (!form) return
    const data = new FormData(form)
    const field = (name: 'a' | 'b') => {
      const value = data.get(name)
      return typeof value === 'string' ? value : null
    }
    const a = parseFighterRef(field('a'))
    const b = parseFighterRef(field('b'))
    if (a && b) props.onFight({ a, b })
  }

  const select = (side: 'a' | 'b', label: string) => (
    <label class={ui.field}>
      <span>{label}</span>
      <select name={side} value={formatFighterRef(props.current[side])}>
        <For each={groups()}>
          {(g) => (
            <optgroup label={g.group}>
              <For each={g.options}>
                {(o) => (
                  <option value={formatFighterRef(o.ref)}>{o.label}</option>
                )}
              </For>
            </optgroup>
          )}
        </For>
      </select>
    </label>
  )

  return (
    <form
      ref={form}
      class={ui.picker}
      aria-label="Choose the fighters"
      onSubmit={submit}
    >
      {select('a', 'Fighter A')}
      {select('b', 'Fighter B')}
      <div class={ui.actions}>
        <button
          type="button"
          class={ui.button}
          onClick={() => {
            props.onClose()
          }}
        >
          Cancel
        </button>
        <button type="submit" class={ui.button} data-primary="">
          Fight
        </button>
      </div>
    </form>
  )
}
