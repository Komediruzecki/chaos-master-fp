/** Geometry, material and model controls for the gummy workbench. */
import { For, Show } from 'solid-js'
import { normalizeGummyParticleTuning } from '@/simulation/gummy/gummyParticleTuning'
import styles from './GummyBearPage.module.css'
import { gummyBenchMaterialHint } from './gummyBenchCopy'
import { GummyTuningControls } from './GummyTuningControls'
import type { GummyBench } from './useGummyBench'
import type { GummyPalette } from '@/components/GummyBear/GummyBearScene'

const PALETTES: readonly { id: GummyPalette; name: string; color: string }[] = [
  { id: 'blue', name: 'Blue', color: '#227ed2' },
  { id: 'amber', name: 'Amber', color: '#de941b' },
  { id: 'berry', name: 'Berry', color: '#b34e75' },
  {
    id: 'candy',
    name: 'Candy',
    color:
      'linear-gradient(to top, #de941b 0% 25%, #36a971 42% 62%, #db4e79 80%, #ad2854 100%)',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    color:
      'linear-gradient(to top, #de941b 0% 25%, #28c4bd 42% 62%, #285bcf 80% 100%)',
  },
  {
    id: 'marble',
    name: 'Marble',
    color:
      'conic-gradient(from 35deg, #b34e75, #de941b 35%, #28c4bd 43% 48%, #922b5a 62%, #de941b 85%, #b34e75)',
  },
]

export function GummyBenchControls(props: { bench: GummyBench }) {
  return (
    <>
      <Show when={props.bench.tearProtocol()}>
        <fieldset
          class={styles.fieldset}
          disabled={!props.bench.ready() && !props.bench.error()}
          aria-describedby="gummy-geometry-help"
        >
          <legend id="gummy-geometry-label">Geometry</legend>
          <div class={styles.segments}>
            <button
              type="button"
              aria-pressed={props.bench.geometry() === 'standard'}
              onClick={() => {
                props.bench.selectGeometry('standard')
              }}
            >
              Standard
            </button>
            <button
              type="button"
              aria-pressed={props.bench.geometry() === 'fine'}
              onClick={() => {
                props.bench.selectGeometry('fine')
              }}
            >
              Fine
            </button>
          </div>
          <p id="gummy-geometry-help" class={styles.note}>
            Fine adds detail to bending and torn edges. It takes more processing
            time. Changing geometry resets the bear.
          </p>
        </fieldset>
        <fieldset
          class={styles.fieldset}
          disabled={!props.bench.ready() || !!props.bench.error()}
          aria-describedby="gummy-surface-help"
        >
          <legend>Torn surface</legend>
          <div class={styles.segments}>
            <button
              type="button"
              aria-pressed={props.bench.surface() === 'original'}
              onClick={() => props.bench.setSurface('original')}
            >
              Original
            </button>
            <button
              type="button"
              aria-pressed={props.bench.surface() === 'rounded'}
              onClick={() => props.bench.setSurface('rounded')}
            >
              Rounded
            </button>
          </div>
          <p id="gummy-surface-help" class={styles.note}>
            Round torn corners. Switch views without resetting the bear.
          </p>
        </fieldset>
      </Show>
      <fieldset
        class={styles.fieldset}
        disabled={!props.bench.ready() || !!props.bench.error()}
      >
        <legend>Material</legend>
        <Show when={props.bench.particle()}>
          <div class={styles.responseControl}>
            <div
              class={styles.segments}
              role="group"
              aria-label="Particle material"
              aria-describedby="gummy-particle-material-help"
            >
              <button
                type="button"
                aria-pressed={props.bench.particleMaterial() === 'warm'}
                onClick={() => {
                  props.bench.selectParticleMaterial('warm')
                }}
              >
                Warm jelly
              </button>
              <button
                type="button"
                aria-pressed={props.bench.particleMaterial() === 'elastic'}
                onClick={() => {
                  props.bench.selectParticleMaterial('elastic')
                }}
              >
                Elastic jelly
              </button>
            </div>
            <p id="gummy-particle-material-help" class={styles.note}>
              Warm jelly yields as you stretch it. Elastic jelly keeps the
              earlier springy response. Switching resets the study.
            </p>
          </div>
        </Show>
        <Show when={props.bench.tearProtocol()}>
          <div class={styles.responseControl}>
            <span id="gummy-response-label" class={styles.sliderLabel}>
              Tear response
            </span>
            <div
              class={styles.segments}
              role="group"
              aria-labelledby="gummy-response-label"
              aria-describedby="gummy-response-help"
            >
              <button
                type="button"
                aria-pressed={props.bench.tearResponse() === 'soft'}
                onClick={() => {
                  props.bench.selectTearResponse('soft')
                }}
              >
                Soft tear
              </button>
              <button
                type="button"
                aria-pressed={props.bench.tearResponse() === 'crumble'}
                onClick={() => {
                  props.bench.selectTearResponse('crumble')
                }}
              >
                Crumble
              </button>
            </div>
            <p id="gummy-response-help" class={styles.note}>
              Soft tear stretches and holds some of the new shape. Crumble
              breaks quickly into small pieces. Changing the response resets the
              bear.
            </p>
          </div>
        </Show>
        <label class={styles.sliderLabel} for="gummy-softness">
          Softness<output>{Math.round(props.bench.softness() * 100)}%</output>
        </label>
        <input
          id="gummy-softness"
          class={styles.slider}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={props.bench.softness()}
          onInput={(event) =>
            props.bench.setSoftness(Number(event.currentTarget.value))
          }
        />
        <Show
          when={
            props.bench.tearProtocol() ||
            (props.bench.particle() &&
              props.bench.particleMaterial() === 'warm')
          }
        >
          <label class={styles.sliderLabel} for="gummy-fragility">
            Fragility
            <output>{Math.round(props.bench.fragility() * 100)}%</output>
          </label>
          <input
            id="gummy-fragility"
            class={styles.slider}
            type="range"
            min="0"
            max="100"
            step="1"
            value={props.bench.fragility() * 100}
            onInput={(event) =>
              props.bench.setFragility(Number(event.currentTarget.value) / 100)
            }
          />
        </Show>
        <label class={styles.check}>
          <input
            type="checkbox"
            checked={props.bench.activeTearing()}
            disabled={props.bench.continuous() && !props.bench.tearProtocol()}
            onChange={(event) =>
              props.bench.continuous()
                ? props.bench.setJellyTearing(event.currentTarget.checked)
                : props.bench.setTearing(event.currentTarget.checked)
            }
          />
          <span>Allow tearing</span>
        </label>
        <p class={styles.note}>
          {gummyBenchMaterialHint(
            props.bench.experiment(),
            props.bench.protocol(),
            props.bench.particleMaterial(),
          )}
        </p>
        <Show when={props.bench.experiment() === 'mpm'}>
          <label class={styles.check}>
            <input
              type="checkbox"
              checked={props.bench.caustics()}
              onChange={(event) =>
                props.bench.setCaustics(event.currentTarget.checked)
              }
            />
            <span>Floor caustics</span>
          </label>
          <p class={styles.note}>
            Colour the floor with light bent through the jelly.
          </p>
        </Show>
        <Show when={props.bench.particle()}>
          <GummyTuningControls
            tuning={props.bench.tuning()}
            onTuningChange={(patch) =>
              props.bench.setTuning((current) =>
                normalizeGummyParticleTuning({ ...current, ...patch }),
              )
            }
            grabRadius={props.bench.grabRadius()}
            onGrabRadius={props.bench.setGrabRadius}
            maxPull={props.bench.maxPull()}
            onMaxPull={props.bench.setMaxPull}
            pinnedFeet={props.bench.pinnedFeet()}
            onPinnedFeet={props.bench.selectPinnedFeet}
            warm={props.bench.particleMaterial() === 'warm'}
            bear={props.bench.particleFixture() !== 'blobs'}
            chessPiece={props.bench.chessPiece()}
            disabled={!props.bench.ready() || !!props.bench.error()}
            onReset={props.bench.restoreTuning}
          />
        </Show>
        <Show
          when={
            !props.bench.particle() || props.bench.particleFixture() !== 'blobs'
          }
        >
          <div
            class={styles.palettes}
            role="radiogroup"
            aria-label="Gummy palette"
            aria-describedby="gummy-layered-colors"
          >
            <For each={PALETTES}>
              {(choice) => (
                <label
                  class={styles.palette}
                  data-active={props.bench.palette() === choice.id}
                >
                  <input
                    type="radio"
                    name="gummy-palette"
                    value={choice.id}
                    checked={props.bench.palette() === choice.id}
                    onChange={() => props.bench.setPalette(choice.id)}
                  />
                  <span
                    class={styles.swatch}
                    style={{ background: choice.color }}
                  />
                  <span>{choice.name}</span>
                </label>
              )}
            </For>
          </div>
          <p id="gummy-layered-colors" class={styles.paletteHelp}>
            Candy and Lagoon use layers that stretch with the gummy. Marble
            swirls flow with it, too.
          </p>
        </Show>
      </fieldset>
      <fieldset class={styles.fieldset}>
        <legend>Model</legend>
        <div
          class={`${styles.segments} ${styles.models}`}
          role="group"
          aria-label="Gummy model"
        >
          <button
            type="button"
            aria-pressed={props.bench.continuous()}
            onClick={() => {
              props.bench.selectExperiment('jelly')
            }}
          >
            Continuous jelly
          </button>
          <button
            type="button"
            aria-pressed={props.bench.experiment() === 'particle'}
            onClick={() => {
              props.bench.selectExperiment('particle')
            }}
          >
            Particle jelly
          </button>
          <button
            type="button"
            aria-pressed={props.bench.experiment() === 'mpm'}
            onClick={() => {
              props.bench.selectExperiment('mpm')
            }}
          >
            MPM + marching cubes
          </button>
          <button
            type="button"
            aria-pressed={props.bench.experiment() === 'crush'}
            onClick={() => {
              props.bench.selectExperiment('crush')
            }}
          >
            Fine crush
          </button>
          <button
            type="button"
            aria-pressed={props.bench.experiment() === 'pull'}
            onClick={() => {
              props.bench.selectExperiment('pull')
            }}
          >
            Limb pull
          </button>
        </div>
        <p class={styles.note}>
          {props.bench.particle()
            ? props.bench.experiment() === 'mpm'
              ? 'Marching cubes builds a 3D surface around the same GPU particles. Switching models resets the study and keeps your material choices.'
              : 'Drag the jelly by hand. Compare the material responses on the same bear or two free blobs.'
            : props.bench.continuous()
              ? 'Grab, stretch or squeeze the body to test how it deforms.'
              : props.bench.experiment() === 'crush'
                ? 'The bear rests on its back beneath the press. Smaller joined regions can separate.'
                : 'The original limb seams, with feet anchored for pulling.'}
        </p>
      </fieldset>
      <Show when={props.bench.continuous()}>
        <fieldset
          class={styles.fieldset}
          disabled={!props.bench.ready() || !!props.bench.error()}
        >
          <legend>Jelly action</legend>
          <div class={styles.segments} role="group" aria-label="Jelly protocol">
            <button
              type="button"
              aria-pressed={props.bench.protocol() === 'squeeze'}
              onClick={() => {
                props.bench.selectProtocol('squeeze')
              }}
            >
              Squeeze &amp; release
            </button>
            <button
              type="button"
              aria-pressed={props.bench.protocol() === 'stretch'}
              onClick={() => {
                props.bench.selectProtocol('stretch')
              }}
            >
              Stretch &amp; release
            </button>
            <button
              type="button"
              aria-pressed={props.bench.protocol() === 'tear'}
              onClick={() => {
                props.bench.selectProtocol('tear')
              }}
            >
              Pull to tear
            </button>
          </div>
          <p class={styles.note}>
            {props.bench.tearProtocol()
              ? 'Body held. Try a short pull by hand. Reset before testing another setting.'
              : 'Load for two seconds, hold for three, then release and watch it recover.'}
          </p>
        </fieldset>
      </Show>
      <p class={styles.keys}>
        {props.bench.tearProtocol() || props.bench.particle()
          ? 'Keyboard: Space pauses, R resets the bear. Arrows orbit, Shift + arrows pan, + and − zoom. Home resets the view.'
          : 'Keyboard: Space pauses, D runs the demo, R resets the bear. Arrows orbit, Shift + arrows pan, + and − zoom. Home resets the view.'}
      </p>
    </>
  )
}
