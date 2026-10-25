/** Stage, save and share material settings without disturbing a running gummy until Apply. */
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, } from 'solid-js'
import { ChevronDown } from '@/icons'
import { GUMMY_BUILTIN_PRESETS } from './gummyBuiltinPresets'
import styles from './GummyPresetControls.module.css'
import { createGummyPreset, GUMMY_PRESET_LIMIT, GUMMY_PRESET_NAME_LIMIT, gummyPresetName, loadGummyPresets, parseGummyPreset, saveGummyPresets, serializeGummyPreset, } from './gummyPresets'
import type { GummyMaterialPreset, GummyPresetSettings } from './gummyPresets'

export function GummyPresetControls(props: {
  current: GummyPresetSettings
  onApply: (settings: GummyPresetSettings) => void
  disabled?: boolean
}) {
  const initial = loadGummyPresets()
  const [presets, setPresets] = createSignal(initial.presets)
  const [open, setOpen] = createSignal(false)
  const [selected, setSelected] = createSignal('')
  const [imported, setImported] = createSignal<GummyMaterialPreset>()
  const [name, setName] = createSignal('My gummy')
  const [status, setStatus] = createSignal(initial.error ?? '')
  const [importOpen, setImportOpen] = createSignal(false)
  const [importJson, setImportJson] = createSignal('')
  const [exportJson, setExportJson] = createSignal('')
  const [copying, setCopying] = createSignal(false)
  const staged = createMemo(
    () => imported() ?? presets().find((preset) => preset.name === selected()),
  )
  const id = createUniqueId()
  let toggle: HTMLButtonElement | undefined
  let exportText: HTMLTextAreaElement | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  function report(error: unknown) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'The preset could not be saved. Copy current is still available.',
    )
  }

  function persist(next: GummyMaterialPreset[], message: string) {
    // The list remains usable during this visit if private mode or a quota blocks storage.
    try {
      saveGummyPresets(undefined, next)
      setStatus(message)
    } catch {
      setStatus(
        'Kept for this visit. Device storage is unavailable, so copy the preset JSON before leaving.',
      )
    }
    setPresets(next)
  }

  function save(update: boolean) {
    try {
      if (!update && presets().length >= GUMMY_PRESET_LIMIT)
        throw new Error(
          `You have ${GUMMY_PRESET_LIMIT} saved presets. Update one or delete one first.`,
        )
      const preset = createGummyPreset(name(), props.current)
      const selectedName = selected()
      if (update && !presets().some((item) => item.name === selectedName))
        return
      if (
        presets().some(
          (item) =>
            item.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase() &&
            (!update || item.name !== selectedName),
        )
      )
        throw new Error(
          'A preset with that name already exists. Use Update selected or choose another name.',
        )
      const next = update
        ? presets().map((item) => (item.name === selectedName ? preset : item))
        : [...presets(), preset]
      persist(
        next,
        update
          ? 'Preset updated from the current settings.'
          : 'Current settings saved on this device.',
      )
      setSelected(preset.name)
      setImported(undefined)
      setName(preset.name)
    } catch (error) {
      report(error)
    }
  }

  function importPreset() {
    try {
      const preset = parseGummyPreset(importJson())
      setImported(preset)
      setSelected('')
      setName(preset.name)
      setStatus(
        `“${preset.name}” is ready. Apply it to reset this figure with those settings.`,
      )
    } catch (error) {
      report(error)
    }
  }

  function applyStartingPreset(preset: GummyMaterialPreset) {
    if (props.disabled) return
    props.onApply(createGummyPreset(preset.name, preset.settings).settings)
    setSelected('')
    setImported(undefined)
    setName(preset.name)
    setExportJson('')
    setStatus(
      `Applied “${preset.name}”. Adjust it, then save your own version.`,
    )
  }

  async function copyCurrent() {
    let json: string
    try {
      json = serializeGummyPreset(
        createGummyPreset(gummyPresetName(name()), props.current),
      )
    } catch (error) {
      report(error)
      return
    }
    setExportJson(json)
    setCopying(true)
    try {
      await globalThis.navigator.clipboard.writeText(json)
      if (!disposed) setStatus('Current preset JSON copied.')
    } catch {
      if (disposed) return
      setStatus(
        'Copy was blocked. The JSON is selected so you can copy it manually.',
      )
      exportText?.focus()
      exportText?.select()
    } finally {
      if (!disposed) setCopying(false)
    }
  }

  return (
    <div
      class={styles.presets}
      data-testid="gummy-preset-controls"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open()) return
        event.stopPropagation()
        setOpen(false)
        toggle?.focus()
      }}
    >
      <button
        ref={toggle}
        type="button"
        class={styles.toggle}
        aria-expanded={open()}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        Presets <ChevronDown aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div
          id={`${id}-panel`}
          class={styles.panel}
          role="region"
          aria-label="Material presets"
        >
          <p class={styles.help}>
            Save the material, colour and drag settings. Apply resets the
            current figure.
          </p>
          <p class={styles.label}>Starting presets</p>
          <p class={styles.help}>
            Tap one to reset with that material. Low to high adds more give and
            easier tearing. RockGummy uses your shared settings.
          </p>
          <div class={styles.row} role="group" aria-label="Starting presets">
            <For each={GUMMY_BUILTIN_PRESETS}>
              {(item) => (
                <button
                  type="button"
                  class={`${styles.button} ${styles.starter}`}
                  aria-label={item.label}
                  aria-describedby={`${id}-${item.id}-description`}
                  disabled={props.disabled}
                  onClick={() => {
                    applyStartingPreset(item.preset)
                  }}
                >
                  <strong>{item.label}</strong>
                  <span id={`${id}-${item.id}-description`}>
                    {item.description}
                  </span>
                </button>
              )}
            </For>
          </div>
          <label class={styles.label} for={`${id}-saved`}>
            Saved preset
          </label>
          <select
            id={`${id}-saved`}
            class={styles.input}
            value={selected()}
            onChange={(event) => {
              const value = event.currentTarget.value
              setSelected(value)
              setImported(undefined)
              if (value) setName(value)
              setStatus(
                value ? 'Preset selected. Apply when you want to use it.' : '',
              )
            }}
          >
            <option value="">Choose a preset</option>
            <For each={presets()}>
              {(preset) => <option value={preset.name}>{preset.name}</option>}
            </For>
          </select>
          <Show when={imported()}>
            {(preset) => <p class={styles.help}>Imported: {preset().name}</p>}
          </Show>
          <button
            type="button"
            class={styles.primary}
            disabled={props.disabled || !staged()}
            onClick={() => {
              const preset = staged()
              if (!preset || props.disabled) return
              props.onApply(
                createGummyPreset(preset.name, preset.settings).settings,
              )
              setStatus(`Applied “${preset.name}”. The figure has been reset.`)
            }}
          >
            Apply preset
          </button>

          <label class={styles.label} for={`${id}-name`}>
            Preset name
          </label>
          <input
            id={`${id}-name`}
            class={styles.input}
            type="text"
            value={name()}
            maxLength={GUMMY_PRESET_NAME_LIMIT}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <p class={styles.help}>
            Save and copy use your current slider settings.
          </p>
          <div class={styles.row}>
            <button
              type="button"
              class={styles.button}
              onClick={() => {
                save(false)
              }}
            >
              Save as new
            </button>
            <button
              type="button"
              class={styles.button}
              disabled={!selected()}
              onClick={() => {
                save(true)
              }}
            >
              Update selected
            </button>
          </div>
          <div class={styles.row}>
            <button
              type="button"
              class={styles.button}
              disabled={copying()}
              onClick={() => void copyCurrent()}
            >
              {copying() ? 'Copying…' : 'Copy current'}
            </button>
            <button
              type="button"
              class={styles.button}
              aria-expanded={importOpen()}
              aria-controls={`${id}-import`}
              onClick={() => setImportOpen((value) => !value)}
            >
              Import JSON
            </button>
          </div>
          <Show when={selected()}>
            <button
              type="button"
              class={styles.delete}
              onClick={() => {
                persist(
                  presets().filter((preset) => preset.name !== selected()),
                  'Preset deleted from this device.',
                )
                setSelected('')
              }}
            >
              Delete selected
            </button>
          </Show>
          <Show when={importOpen()}>
            <div id={`${id}-import`} class={styles.jsonPanel}>
              <label class={styles.label} for={`${id}-json`}>
                Preset JSON
              </label>
              <textarea
                id={`${id}-json`}
                class={styles.json}
                value={importJson()}
                spellcheck={false}
                onInput={(event) => setImportJson(event.currentTarget.value)}
              />
              <button
                type="button"
                class={styles.button}
                onClick={importPreset}
              >
                Import preset
              </button>
              <p class={styles.help}>
                Import checks the full preset. Apply it, then Save as new to
                keep it on this device.
              </p>
            </div>
          </Show>
          <Show when={exportJson()}>
            <label class={styles.label}>
              Current preset JSON
              <textarea
                ref={exportText}
                class={styles.json}
                readOnly
                spellcheck={false}
                value={exportJson()}
              />
            </label>
          </Show>
          <p class={styles.status} role="status" aria-live="polite">
            {status() ||
              'Presets are saved on this device. Copy JSON to share or back them up.'}
          </p>
        </div>
      </Show>
    </div>
  )
}
