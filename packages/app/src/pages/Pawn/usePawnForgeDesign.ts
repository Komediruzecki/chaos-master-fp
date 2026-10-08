/** Keep saved chess editing isolated from the original lattice and echo Forge drafts. */
import { batch, createMemo, createSignal } from 'solid-js'
import { DEFAULT_PAWN_RECIPE, normalizePawnRecipe, } from '@/flame/chess/pawnFlame'
import { DEFAULT_STRUCTURAL_PAWN_RECIPE } from '@/flame/chess/structuralPawnFlame'
import { buildGummyAuthoredPawnFlame, createGummyAuthoredPawn, gummyAuthoredPawnKey, } from '@/simulation/gummy/gummyAuthoredPawn'
import { persistentSignal } from '@/utils/persistentSignal'
import { loadGummyPawnLibrary, readGummyPawnForForge } from './gummyPawnLibrary'
import { buildPawnDesignFlame, createPawnDesign, createPawnDesignDraft, restorePawnDesignDraft, } from './pawnDesign'
import { readLegacyPawnDraft } from './pawnDesignStorage'
import type { PawnDesign, PawnForm } from './pawnDesign'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'
import type { GummyAuthoredPawn } from '@/simulation/gummy/gummyAuthoredPawn'

export function usePawnForgeDesign() {
  const legacyDraft = readLegacyPawnDraft()
  const [design, setDesign] = persistentSignal<PawnDesign, unknown>(
    'pawn-forge-experiments',
    createPawnDesign(legacyDraft),
    {
      serialize: createPawnDesignDraft,
      deserialize: (raw) => restorePawnDesignDraft(raw, legacyDraft),
    },
  )
  const opened = readGummyPawnForForge(window.location.search)
  const [authored, setAuthored] = createSignal(opened.pawn)
  const [authoredActive, setAuthoredActive] = createSignal(!!opened.pawn)
  const [metadata, setMetadata] = createSignal(
    opened.pawn ?? createGummyAuthoredPawn(),
  )
  const [savedKey, setSavedKey] = createSignal(
    loadGummyPawnLibrary().pawns.some(
      (pawn) =>
        gummyAuthoredPawnKey(pawn) === gummyAuthoredPawnKey(opened.pawn),
    )
      ? gummyAuthoredPawnKey(opened.pawn)
      : undefined,
  )
  const form = createMemo(() =>
    authored() ? (authoredActive() ? 'lattice' : 'echo') : design().selected,
  )
  const recipe = createMemo(() =>
    authoredActive() ? authored()!.recipe : design().recipes[form()],
  )
  const chessPawn = createMemo(() => ({
    ...metadata(),
    recipe: { ...recipe() },
  }))
  const thickness = createMemo(() => metadata().thickness)
  const version = createMemo(() => metadata().version)
  const seed = createMemo(() => metadata().seed)
  const flame = createMemo(() =>
    authoredActive()
      ? buildGummyAuthoredPawnFlame({
          ...createGummyAuthoredPawn(recipe()),
          version: version(),
          seed: seed(),
          thickness: thickness(),
        })
      : buildPawnDesignFlame(form(), recipe()),
  )

  function updateRecipe(patch: Partial<PawnRecipe>) {
    if (authoredActive()) {
      setAuthored((current) => ({
        ...current!,
        recipe: normalizePawnRecipe({ ...current!.recipe, ...patch }),
      }))
    } else {
      const selected = form()
      setDesign((current) => ({
        ...current,
        recipes: {
          ...current.recipes,
          [selected]: normalizePawnRecipe({
            ...current.recipes[selected],
            ...patch,
          }),
        },
      }))
    }
  }

  function selectForm(selected: PawnForm) {
    // Selecting Echo during a chess edit exposes its original draft; the chess edit remains recoverable.
    setAuthoredActive(selected === 'lattice' && !!authored())
    if (!authored()) setDesign((current) => ({ ...current, selected }))
  }

  function restoreDraft() {
    batch(() => {
      setAuthored(undefined)
      setAuthoredActive(false)
      setMetadata(createGummyAuthoredPawn())
      setSavedKey(undefined)
    })
    const url = new URL(window.location.href)
    url.searchParams.delete('chessPawn')
    window.history.replaceState(null, '', url)
  }

  function saved(pawn: GummyAuthoredPawn) {
    batch(() => {
      setAuthored({ ...pawn, recipe: { ...pawn.recipe } })
      setMetadata({ ...pawn, recipe: { ...pawn.recipe } })
      setSavedKey(gummyAuthoredPawnKey(pawn))
      setAuthoredActive(true)
    })
  }

  function inspectForChess() {
    const pawn = chessPawn()
    batch(() => {
      setAuthored({ ...pawn, recipe: { ...pawn.recipe } })
      setAuthoredActive(true)
    })
  }
  return {
    form,
    recipe,
    flame,
    chessPawn,
    authoredActive,
    savedKey,
    updateRecipe,
    selectForm,
    restoreDraft,
    saved,
    inspectForChess,
    selectGenerator: (selected: GummyAuthoredPawn['version']) => {
      setMetadata((current) => ({ ...current, version: selected }))
    },
    openError: opened.error,
    hasAuthoredEdit: () => !!authored(),
    updateMetadata: (
      patch: Partial<Pick<GummyAuthoredPawn, 'name' | 'thickness'>>,
    ) => setMetadata((current) => ({ ...current, ...patch })),
    removed: () => {
      setSavedKey(undefined)
    },
    resetShape: () => {
      updateRecipe(
        authoredActive()
          ? createGummyAuthoredPawn({}, metadata().name, metadata().version)
              .recipe
          : form() === 'echo'
            ? DEFAULT_PAWN_RECIPE
            : DEFAULT_STRUCTURAL_PAWN_RECIPE,
      )
    },
  }
}
