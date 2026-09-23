/**
 * The partner gallery's hover preview, and the pick that commits a partner.
 *
 * The gallery serves five pickers, and what a hover shows depends on which
 * one it is serving: a child of the two flames for a breed, the blend for a
 * blend or a morph, and nothing at all for Evolve and Diff, which open a view
 * of the flame and never use a blend (maff's call; the tile's name still
 * shows over the canvas). A hover that arrives for one picker ends whatever
 * another left showing, since the picker can change inside the gallery's
 * clear delay, and Breed must never cross a blend into its parent A.
 *
 * Hovering a tile writes the document silently: a hover must not reach the
 * undo stack or the recorder. Leaving the tiles puts back exactly what the
 * document had, an absent weight included, and so does every other way out:
 * the gallery ends its preview however it goes away, when Home or the Arcade
 * covers it and when the page is hidden (BlendFlameGallery), an Evolve or
 * Diff pick ends it before the view it opens reads the document
 * (WorkspaceSidebar), and MainWorkspace ends it before every undo and redo,
 * so time travel is computed against the document the entry describes.
 *
 * Putting back is only right while the document still holds what the
 * preview wrote. A load, a replay or anything else that replaces the
 * document under a resting pointer made the old restore write stale fields
 * over the new document; now the preview is dropped instead, and a hover
 * that follows starts from the new document.
 *
 * Nothing that saves the document may store a preview either: `withoutPreview`
 * is the document as it is with the hover taken off, which is what autosave
 * reads (useWorkspaceAutosave).
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

/** A value as JSON with its keys sorted: the store keeps a partner's keys in
 *  whatever order its writes left them, so a plain stringify of the same
 *  flame could differ from the copy that was written. */
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field !== null && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(
          Object.entries(field).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : field,
  )
}

/** The fields of a blend preview, as a document holds them. */
function blendFields(flame: FlameDescriptor): string {
  const { blendFlame, blendWeight } = unwrap(flame).renderSettings
  return fingerprint({ blendFlame, blendWeight })
}

/**
 * The part of a document a breed preview is recognised by: the child's own
 * transforms and name. Not its render settings, which the 3D auto-exposure
 * rewrites under a showing child (useWorkspaceCamera).
 */
function breedFields(flame: FlameDescriptor): string {
  const { transforms, metadata } = unwrap(flame)
  return fingerprint({ transforms, metadata })
}

export function useWorkspaceBlendPick(params: UseWorkspaceBlendPickParams) {
  const intent = params.intent ?? (() => 'blend' as const)
  let replaced: ReplacedBlend | undefined
  /** The blend fields the preview wrote, to recognise them by. */
  let blendShown: string | undefined

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
  /** The child the breed preview wrote, to recognise it by. */
  let breedShown: string | undefined
  let breedTimer: ReturnType<typeof setTimeout> | undefined

  /** The document still shows the blend the preview wrote. */
  const holdsBlend = () =>
    blendShown !== undefined && blendFields(params.flame()) === blendShown
  /** The document still shows the child the breed preview wrote. */
  const holdsBreed = () =>
    breedShown !== undefined && breedFields(params.flame()) === breedShown

  /**
   * Forget a preview the document no longer shows: something replaced it
   * (a load, a replay), and what it replaced is stale.
   */
  function dropStale(): void {
    if (replaced !== undefined && !holdsBlend()) {
      replaced = undefined
      blendShown = undefined
    }
    if (breedRestore !== undefined && !holdsBreed()) {
      breedRestore = undefined
      breedShown = undefined
      setBreedChild(undefined)
    }
  }

  function writeDescriptor(next: FlameDescriptor) {
    const value = deepClone(next)
    params.setSilently((draft) => {
      draft.version = value.version
      draft.metadata = value.metadata
      draft.renderSettings = value.renderSettings
      draft.transforms = value.transforms
    })
  }

  /** Put back the flame a breed preview replaced, if the child is still
   *  what the document shows. */
  function endBreed(): void {
    clearTimeout(breedTimer)
    breedTimer = undefined
    dropStale()
    setBreedChild(undefined)
    if (breedRestore !== undefined) {
      writeDescriptor(breedRestore)
      breedRestore = undefined
      breedShown = undefined
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
      dropStale()
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
      breedShown = breedFields(params.flame())
    }, BREED_PREVIEW_DELAY_MS)
  }

  /**
   * The gallery's hover: a child for a breed, the blend for a blend or a
   * morph, nothing for Evolve and Diff, and `null` ends it. Each kind ends
   * the other first: the intent can change inside the gallery's clear delay,
   * under a preview the last picker left, and a breed that started over a
   * live blend crossed it into parent A and into every child it showed.
   */
  function preview(flame: FlameDescriptor | null): void {
    const serving = intent()
    if (flame === null || serving === 'evolve' || serving === 'diff') {
      endBreed()
      endBlend()
    } else if (serving === 'breed') {
      endBlend()
      previewBreedChild(flame)
    } else {
      endBreed()
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
    dropStale()
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
    blendShown = blendFields(params.flame())
  }

  /** Put back what the blend preview replaced, if the document still shows
   *  the preview. Nothing to do without one. */
  function endBlend(): void {
    dropStale()
    const restore = replaced
    if (restore === undefined) return
    replaced = undefined
    blendShown = undefined
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
      end()
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
    endBreed()
    endBlend()
  }

  /**
   * The document as a save should store it: with a hover preview the
   * document still shows taken off, and the document itself otherwise.
   * Reads only; the preview stays on screen.
   */
  function withoutPreview(): FlameDescriptor {
    const flame = params.flame()
    if (breedRestore !== undefined && holdsBreed()) return breedRestore
    const restore = replaced
    if (restore === undefined || !holdsBlend()) return flame
    const saved = deepClone(unwrap(flame))
    if (restore.flame === undefined) delete saved.renderSettings.blendFlame
    else
      saved.renderSettings.blendFlame = deepClone(
        restore.flame,
      )
    if (restore.weight === undefined) delete saved.renderSettings.blendWeight
    else saved.renderSettings.blendWeight = restore.weight
    return saved
  }

  return { preview, end, breedChild, commit, pick, withoutPreview }
}
