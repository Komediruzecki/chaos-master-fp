/**
 * The partner gallery's hover preview, and the pick that commits a partner.
 *
 * The gallery serves five pickers, and what a hover shows depends on which
 * one it is serving: a child of the two flames for a breed, the blend for
 * the rest.
 *
 * Hovering a tile shows the blend at the default weight by writing the
 * document silently: a hover must not reach the undo stack or the recorder.
 * Leaving the tiles puts back exactly what the document had, an absent weight
 * included, and so does every other way out: the gallery ends its preview
 * however it goes away, when Home or the Arcade covers it and when the page
 * is hidden (BlendFlameGallery), and an Evolve or Diff pick ends it before the
 * view it opens reads the document (WorkspaceSidebar).
 *
 * A pick ends the preview first and commits second, inside one batch. The
 * order is the point: the history entry the commit pushes then spans the
 * document as it was before the hover, so one undo returns to exactly that,
 * partner and weight alike, where it used to land on the preview. And the
 * pick names its weight, so the step a take records replays to the blend the
 * viewer saw instead of to whatever weight the replay's document held: every
 * gallery pick starts at the default, as the preview shows it, whatever the
 * previous weight was.
 */
import { batch, createSignal } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { DEFAULT_BLEND_WEIGHT } from '@/flame/blend'
import { breedFlames } from '@/flame/breedFlame'
import { deepClone } from '@/utils/clone'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/** Which picker the gallery is serving. */
export type BlendIntent = 'blend' | 'morph' | 'breed' | 'evolve' | 'diff'

/**
 * How long a candidate must stay hovered before its child is rendered.
 *
 * Slightly longer than the gallery's own 120ms clear delay: a child has a
 * different transform structure from its parent, so showing one rebuilds the
 * IFS pipeline, and sweeping the pointer down a list must not do that once
 * per tile.
 */
export const BREED_PREVIEW_DELAY_MS = 220

export type UseWorkspaceBlendPickParams = {
  /** The workspace document, read when a preview starts. */
  flame: () => FlameDescriptor
  /** The history's silent writer: no entry, no recorder step. */
  setSilently: (fn: (draft: FlameDescriptor) => void) => void
  /** Runs a registered command against the workspace. */
  execute: (id: string, ...args: unknown[]) => void
  /** Which picker the gallery is serving; a blend when omitted. */
  intent?: () => BlendIntent
}

/** What a preview replaced, as stored: an absent field stays absent. The
 *  document keeps its partner unvalidated, so this does too. */
type ReplacedBlend = {
  flame: unknown
  weight: number | undefined
}

export function useWorkspaceBlendPick(params: UseWorkspaceBlendPickParams) {
  const intent = params.intent ?? (() => 'blend' as const)
  let replaced: ReplacedBlend | undefined

  /**
   * The child generated for whichever candidate is hovered, so clicking opens
   * the breed gallery on the flame you were actually looking at rather than
   * nine unrelated ones.
   */
  const [breedChild, setBreedChild] = createSignal<FlameDescriptor | undefined>(
    undefined,
  )
  /** The workspace flame as it was before a breed preview replaced it. */
  let breedRestore: FlameDescriptor | undefined
  let breedTimer: ReturnType<typeof setTimeout> | undefined

  function writeDescriptor(next: FlameDescriptor) {
    const value = deepClone(next)
    params.setSilently((draft) => {
      draft.version = value.version
      draft.metadata = value.metadata
      draft.renderSettings = value.renderSettings
      draft.transforms = value.transforms
    })
  }

  /** Put back the flame a breed preview replaced. */
  function endBreed(): void {
    clearTimeout(breedTimer)
    breedTimer = undefined
    setBreedChild(undefined)
    if (breedRestore !== undefined) {
      writeDescriptor(breedRestore)
      breedRestore = undefined
    }
  }

  /**
   * Hovering a candidate while breeding shows an actual CHILD of the two
   * flames, not a 40% blend of them.
   *
   * A blend is the wrong thing to show here twice over: it is not what
   * breeding produces, and it cannot render at all in 3D — `ifsPipeline3D`
   * has no blend input, so the old preview changed the hovered NAME while the
   * picture sat still. A real child works in both dimensions, because
   * `breedFlames` carries `variations3D`.
   *
   * Debounced, and this matters: a child has a different transform STRUCTURE
   * from its parent, so applying one rebuilds the IFS pipeline. Sweeping the
   * pointer across a list must not rebuild once per tile.
   */
  function previewBreedChild(flame: FlameDescriptor): void {
    clearTimeout(breedTimer)
    breedTimer = setTimeout(() => {
      const parentA = breedRestore ?? unwrap(params.flame())
      const [child] = breedFlames(parentA, flame, {
        count: 1,
        crossoverMode: 'uniform',
        mutationStrength: 0.1,
      })
      if (child === undefined) {
        return
      }
      // Snapshot once per hover run, not per tile: the restore target is the
      // flame the user arrived with, never a previously previewed child.
      breedRestore ??= deepClone(unwrap(params.flame()))
      setBreedChild(child)
      writeDescriptor(child)
    }, BREED_PREVIEW_DELAY_MS)
  }

  /**
   * The gallery's hover: a child for a breed, the blend for the rest, and
   * `null` ends it. Ending it ends both, whatever the intent is by then,
   * since the intent can change under a live preview. The gallery ends what
   * it started however it is left, closed or not (BlendFlameGallery).
   */
  function preview(flame: FlameDescriptor | null): void {
    if (flame === null) {
      endBreed()
      endBlend()
    } else if (intent() === 'breed') {
      previewBreedChild(flame)
    } else {
      previewBlend(flame)
    }
  }

  /** Show `flame` as the blend partner. */
  function previewBlend(flame: FlameDescriptor): void {
    // The hover preview IS the blend mechanism, and blending is 2D-only:
    // `ifsPipeline3D.update()` takes a single flame — it has no blend input at
    // all, so `renderSettings.blendFlame` is silently ignored in 3D. Writing it
    // anyway changed the hovered NAME while the picture stayed put, which reads
    // as a broken preview rather than an unsupported one. Skip it instead.
    if ((flame.renderSettings.dimensions ?? 2) === 3) return
    if (replaced === undefined) {
      const { blendFlame, blendWeight } = params.flame().renderSettings
      replaced = {
        flame: blendFlame === undefined ? undefined : deepClone(blendFlame),
        weight: blendWeight,
      }
    }
    params.setSilently((draft) => {
      draft.renderSettings.blendFlame = deepClone(flame)
      draft.renderSettings.blendWeight = DEFAULT_BLEND_WEIGHT
    })
  }

  /** Put back what the blend preview replaced. Nothing to do without one. */
  function endBlend(): void {
    const restore = replaced
    if (restore === undefined) return
    replaced = undefined
    params.setSilently((draft) => {
      if (restore.flame === undefined) delete draft.renderSettings.blendFlame
      else draft.renderSettings.blendFlame = deepClone(restore.flame)
      if (restore.weight === undefined) delete draft.renderSettings.blendWeight
      else draft.renderSettings.blendWeight = restore.weight
    })
  }

  /**
   * Run a commit that follows a preview: the preview ends first, so the
   * commit's history entry starts from the document before the hover. One
   * batch, so nothing renders or rebuilds for the restored state in between.
   */
  function commit(run: () => void): void {
    batch(() => {
      endBlend()
      run()
    })
  }

  /** Commit a partner picked in the gallery, at the weight its preview showed. */
  function pick(flame: FlameDescriptor): void {
    commit(() => {
      params.execute('flame.setBlendFlame', flame, DEFAULT_BLEND_WEIGHT)
    })
  }

  /** End whatever hover preview is showing. */
  function end(): void {
    preview(null)
  }

  return { preview, end, endBreed, breedChild, commit, pick }
}
