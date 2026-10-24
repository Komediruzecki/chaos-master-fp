/** Draft native look and camera edits apply together, preserving the current take until requested. */
import { For } from 'solid-js'
import { FRACTAL_CHESS_COLLECTIONS } from '@/flame/chess/fractalChessCollections'
import styles from './GummyCinemaPage.module.css'
import type { NativeCinemaRecipe } from './nativeCinemaRecipe'

export function NativeCinemaStagingControls(props: {
  draft: NativeCinemaRecipe
  busy: boolean
  onDraft: (value: NativeCinemaRecipe) => void
  onApply: () => void
}) {
  const patch = (value: Partial<NativeCinemaRecipe>) => {
    props.onDraft({ ...props.draft, ...value })
  }
  return (
    <fieldset class={styles.fields} disabled={props.busy}>
      <legend>Stage the fractal shot</legend>
      <label for="native-collection">Collection</label>
      <select
        id="native-collection"
        value={props.draft.nativeCollection.id}
        onChange={(e) => {
          patch({
            nativeCollection: {
              ...props.draft.nativeCollection,
              id: e.currentTarget
                .value as NativeCinemaRecipe['nativeCollection']['id'],
            },
          })
        }}
      >
        <For each={FRACTAL_CHESS_COLLECTIONS}>
          {(collection) => (
            <option value={collection.id}>{collection.name}</option>
          )}
        </For>
      </select>
      <label for="native-enclosure">Enclosure</label>
      <select
        id="native-enclosure"
        value={props.draft.nativeCollection.enclosure}
        onChange={(e) => {
          patch({
            nativeCollection: {
              ...props.draft.nativeCollection,
              enclosure: e.currentTarget.value as 'pure' | 'glass',
            },
          })
        }}
      >
        <option value="pure">Pure fractals</option>
        <option value="glass">Glass study</option>
      </select>
      <p class={styles.help}>
        Glass fits the fern knight, split-current bishop or window rook in its
        own collection.
      </p>
      <label for="native-camera">Camera movement</label>
      <select
        id="native-camera"
        value={props.draft.camera}
        onChange={(e) => {
          patch({
            camera: e.currentTarget.value as NativeCinemaRecipe['camera'],
          })
        }}
      >
        <option value="arc">Arc</option>
        <option value="diagonal">Diagonal</option>
        <option value="hero">Hero</option>
      </select>
      <label for="native-quality">Fractal detail</label>
      <select
        id="native-quality"
        value={props.draft.quality}
        onChange={(e) => {
          patch({
            quality: e.currentTarget.value as NativeCinemaRecipe['quality'],
          })
        }}
      >
        <option value="normal">Normal</option>
        <option value="fine">Fine</option>
      </select>
      <label for="native-scale">
        Piece size: {Math.round(props.draft.scale * 100)}%
      </label>
      <input
        id="native-scale"
        type="range"
        min="0.85"
        max="1"
        step="0.01"
        value={props.draft.scale}
        onInput={(e) => {
          patch({ scale: Number(e.currentTarget.value) })
        }}
      />
      <button
        class={`${styles.button} ${styles.apply}`}
        type="button"
        onClick={props.onApply}
      >
        Apply shot settings
      </button>
    </fieldset>
  )
}
