/** Live pawn workshop: tune a native 3D IFS and retain an editable recipe. */
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { PawnStage } from '@/components/PawnStage/PawnStage'
import { useToast } from '@/contexts/ToastContext'
import { DEFAULT_PAWN_RECIPE, normalizePawnRecipe, PAWN_RECIPE_LIMITS, } from '@/flame/chess/pawnFlame'
import { DEFAULT_STRUCTURAL_PAWN_RECIPE } from '@/flame/chess/structuralPawnFlame'
import { downloadBlob } from '@/utils/blob'
import { encodeSharePayload } from '@/utils/jsonQueryParam'
import { persistentSignal } from '@/utils/persistentSignal'
import { buildPawnDesignFlame, createPawnDesign, createPawnDesignDraft, restorePawnDesignDraft, serializePawnDesignExport, } from './pawnDesign'
import { readLegacyPawnDraft } from './pawnDesignStorage'
import styles from './PawnPage.module.css'
import type { PawnDesign, PawnForm } from './pawnDesign'
import type { PawnRenderStatus } from '@/components/PawnStage/PawnStage'
import type { PawnRecipe } from '@/flame/chess/pawnFlame'

export function PawnPage() {
  const { showToast } = useToast()
  const legacyDraft = readLegacyPawnDraft()
  const [design, setDesign] = persistentSignal<PawnDesign, unknown>(
    'pawn-forge-experiments',
    createPawnDesign(legacyDraft),
    {
      serialize: createPawnDesignDraft,
      deserialize: (raw) => restorePawnDesignDraft(raw, legacyDraft),
    },
  )
  const [resetViewKey, setResetViewKey] = createSignal(0)
  const [openingEditor, setOpeningEditor] = createSignal(false)
  const [renderStatus, setRenderStatus] = createSignal<PawnRenderStatus>({
    pointCount: 0,
    progress: 0,
    ready: false,
  })
  const form = createMemo(() => design().selected)
  const recipe = createMemo(() => design().recipes[form()])
  const flame = createMemo(() => buildPawnDesignFlame(form(), recipe()))
  const twistDegrees = createMemo(() =>
    Math.round((recipe().twist * 180) / Math.PI),
  )
  const sampleLabel = createMemo(() => {
    const count = renderStatus().pointCount
    return count >= 1_000_000
      ? `${(count / 1_000_000).toFixed(1)}M samples`
      : `${Math.round(count / 1000)}K samples`
  })

  onMount(() => {
    const oldTitle = document.title
    document.title = 'Pawn Forge · Lumen Apeiron'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    onCleanup(() => {
      robots.remove()
      document.title = oldTitle
    })
  })

  function updateRecipe(patch: Partial<PawnRecipe>) {
    setDesign((current) => ({
      ...current,
      recipes: {
        ...current.recipes,
        [current.selected]: normalizePawnRecipe({
          ...current.recipes[current.selected],
          ...patch,
        }),
      },
    }))
  }

  function selectForm(selected: PawnForm) {
    setDesign((current) => ({ ...current, selected }))
    setResetViewKey((key) => key + 1)
  }

  function resetShape() {
    updateRecipe(
      form() === 'echo' ? DEFAULT_PAWN_RECIPE : DEFAULT_STRUCTURAL_PAWN_RECIPE,
    )
    setResetViewKey((key) => key + 1)
  }

  function downloadRecipe() {
    const current = recipe()
    downloadBlob(
      new Blob([serializePawnDesignExport(form(), current)], {
        type: 'application/json',
      }),
      `fractal-pawn-${form()}-${current.side}.json`,
    )
  }

  async function openEditor() {
    if (openingEditor()) return
    setOpeningEditor(true)
    try {
      const payload = await encodeSharePayload(flame())
      const url = new URL('/', window.location.origin)
      url.searchParams.set('flame', payload)
      window.location.assign(url)
    } catch {
      showToast(
        'Could not open the pawn in the editor. Try downloading its recipe.',
      )
      setOpeningEditor(false)
    }
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <span class={styles.chapter}>Fractal chess / 01</span>
      </header>
      <div class={styles.workshop}>
        <section class={styles.preview} aria-label="Pawn preview">
          <div class={styles.previewHeader}>
            <span class={styles.eyebrow}>
              {form() === 'echo' ? 'Glass echo' : 'Crystal lattice'}
            </span>
            <span class={styles.scale}>1.8 m</span>
          </div>
          <PawnStage
            flame={flame()}
            resetViewKey={resetViewKey()}
            ariaLabel="Interactive three dimensional fractal pawn"
            onStatusChange={setRenderStatus}
          />
          <div class={styles.previewFooter}>
            <p>Drag to orbit. Scroll or pinch to zoom.</p>
            <button
              type="button"
              class={styles.quietButton}
              onClick={() => setResetViewKey((key) => key + 1)}
            >
              Reset view
            </button>
          </div>
          <div class={styles.renderLine}>
            <span>
              {renderStatus().ready ? 'Preview settled' : 'Growing the pawn'}
            </span>
            <span>{sampleLabel()}</span>
          </div>
        </section>

        <section class={styles.controls} aria-labelledby="pawn-title">
          <div class={styles.intro}>
            <p class={styles.eyebrow}>Pawn forge</p>
            <h1 id="pawn-title">Shape a fractal pawn.</h1>
            <p class={styles.description}>
              {form() === 'echo'
                ? 'The original pawn: a rounded body with smaller pawns repeating inside it.'
                : 'A branching stem and a faceted head. Cavities repeat through the structure as you look closer.'}
            </p>
          </div>

          <fieldset class={styles.formField}>
            <legend>Choose a form</legend>
            <div class={styles.formOptions}>
              <label class={styles.formOption}>
                <input
                  type="radio"
                  name="pawn-form"
                  aria-label="Crystal lattice"
                  value="lattice"
                  checked={form() === 'lattice'}
                  onChange={() => {
                    selectForm('lattice')
                  }}
                />
                <span>
                  <strong>Crystal lattice</strong>
                  <small>Recursive edges and cavities</small>
                </span>
              </label>
              <label class={styles.formOption}>
                <input
                  type="radio"
                  name="pawn-form"
                  aria-label="Glass echo"
                  value="echo"
                  checked={form() === 'echo'}
                  onChange={() => {
                    selectForm('echo')
                  }}
                />
                <span>
                  <strong>Glass echo</strong>
                  <small>Original form, preserved</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset class={styles.sideField}>
            <legend>Choose a side</legend>
            <div class={styles.sideOptions}>
              <label class={styles.sideOption}>
                <input
                  type="radio"
                  name="pawn-side"
                  value="light"
                  checked={recipe().side === 'light'}
                  onChange={() => {
                    updateRecipe({ side: 'light' })
                  }}
                />
                <span>Frost</span>
              </label>
              <label class={styles.sideOption}>
                <input
                  type="radio"
                  name="pawn-side"
                  value="dark"
                  checked={recipe().side === 'dark'}
                  onChange={() => {
                    updateRecipe({ side: 'dark' })
                  }}
                />
                <span>Ember</span>
              </label>
            </div>
          </fieldset>

          <label class={styles.sliderField} for="pawn-symmetry">
            <span class={styles.fieldTitle}>
              Symmetry{' '}
              <output>
                {recipe().branchCount}
                {form() === 'echo' ? ' branches' : ' branch pairs'}
              </output>
            </span>
            <input
              id="pawn-symmetry"
              type="range"
              min={PAWN_RECIPE_LIMITS.branchCount.min}
              max={PAWN_RECIPE_LIMITS.branchCount.max}
              step="1"
              value={recipe().branchCount}
              onInput={(event) => {
                updateRecipe({ branchCount: event.currentTarget.valueAsNumber })
              }}
            />
            <span class={styles.hint}>
              {form() === 'echo'
                ? 'Arrange the echoes around the pawn.'
                : 'Arrange branching pairs around the stem.'}
            </span>
          </label>
          <label class={styles.sliderField} for="pawn-openness">
            <span class={styles.fieldTitle}>
              Openness <output>{Math.round(recipe().openness * 100)}%</output>
            </span>
            <input
              id="pawn-openness"
              type="range"
              min="0"
              max="100"
              step="1"
              value={recipe().openness * 100}
              onInput={(event) => {
                updateRecipe({
                  openness: event.currentTarget.valueAsNumber / 100,
                })
              }}
            />
            <span class={styles.hint}>
              {form() === 'echo'
                ? 'Reveal space between the smaller forms.'
                : 'Open larger gaps in the lattice and head.'}
            </span>
          </label>
          <label class={styles.sliderField} for="pawn-twist">
            <span class={styles.fieldTitle}>
              Twist <output>{twistDegrees()}°</output>
            </span>
            <input
              id="pawn-twist"
              type="range"
              min="-180"
              max="180"
              step="1"
              value={twistDegrees()}
              onInput={(event) => {
                updateRecipe({
                  twist: (event.currentTarget.valueAsNumber * Math.PI) / 180,
                })
              }}
            />
            <span class={styles.hint}>
              {form() === 'echo'
                ? 'Turn each echo as it repeats.'
                : 'Twist the stem branches and turn the head.'}
            </span>
          </label>

          <div class={styles.actions}>
            <a class={styles.boardLink} href="/chess">
              Play pawn board
            </a>
            <a class={styles.boardLink} href="/figurines">
              Compare figurine studies
            </a>
            <button
              type="button"
              class={styles.primaryButton}
              onClick={downloadRecipe}
            >
              Download recipe
            </button>
            <button
              type="button"
              class={styles.secondaryButton}
              disabled={openingEditor()}
              onClick={() => {
                void openEditor()
              }}
            >
              {openingEditor() ? 'Opening editor…' : 'Open in editor'}
            </button>
            <button
              type="button"
              class={styles.quietButton}
              onClick={resetShape}
            >
              Reset shape
            </button>
          </div>
          <p class={styles.note}>
            Each form keeps its own controls. Play the pawn board to try your
            saved shape inside glass and capture another piece.
          </p>
        </section>
      </div>
    </main>
  )
}
