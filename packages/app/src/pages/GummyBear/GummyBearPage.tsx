/** A single gummy material and deformation study, isolated from the chess and flame documents. */
import { Show } from 'solid-js'
import { GummyBearScene } from '@/components/GummyBear/GummyBearScene'
import { ParticleGummyBearScene } from '@/components/GummyBear/ParticleGummyBearScene'
import styles from './GummyBearPage.module.css'
import { GummyActions, GummyBenchCameraControls } from './GummyBenchActions'
import { GummyBenchControls } from './GummyBenchControls'
import { GummyErrorNotice } from './GummyErrorNotice'
import { GummyPresetControls } from './GummyPresetControls'
import { GummyRecordingControls } from './GummyRecordingControls'
import { GUMMY_STUDY_LABELS, GummyStudyControls } from './GummyStudyControls'
import { useGummyBench } from './useGummyBench'
import type { GummyBearSceneProps } from '@/components/GummyBear/GummyBearScene'

export function GummyBearPage() {
  const bench = useGummyBench()
  let canvasSlot: HTMLDivElement | undefined

  function actions(compact: boolean) {
    return (
      <GummyActions
        compact={compact}
        manual={bench.tearProtocol() || bench.particle()}
        blobs={bench.particle() && bench.particleFixture() === 'blobs'}
        piece={bench.chessPiece()}
        ready={bench.ready()}
        error={bench.error()}
        paused={bench.paused()}
        replay={bench.demoKey() > 0}
        action={bench.actionName()}
        onReplay={bench.replay}
        onPause={() => bench.setPaused((value) => !value)}
        onReset={bench.reset}
      />
    )
  }

  function recordingControls() {
    return (
      <GummyRecordingControls
        recording={bench.recording}
        ready={bench.ready() && !bench.error()}
        onStart={() => {
          bench.recording.start(canvasSlot?.querySelector('canvas'))
        }}
      />
    )
  }

  const sceneProps: Omit<GummyBearSceneProps, 'experiment' | 'protocol'> = {
    get palette() {
      return bench.palette()
    },
    get mode() {
      return bench.mode()
    },
    get softness() {
      return bench.softness()
    },
    get fragility() {
      return bench.fragility()
    },
    get tearResponse() {
      return bench.tearResponse()
    },
    get geometry() {
      return bench.geometry()
    },
    get surface() {
      return bench.surface()
    },
    get tearing() {
      return bench.activeTearing()
    },
    get paused() {
      return bench.paused()
    },
    get demoKey() {
      return bench.demoKey()
    },
    get resetKey() {
      return bench.resetKey()
    },
    get resetViewKey() {
      return bench.viewKey()
    },
    get reducedMotion() {
      return bench.reducedMotion()
    },
    get recording() {
      return bench.recording.busy()
    },
    get pointerGuide() {
      return bench.pointerGuide()
    },
    onReady: (value) => {
      if (!value)
        bench.recording.stop('Recording finished because the study changed.')
      bench.setReady(value)
    },
    onStatus: bench.setStatus,
    onError: (value) => {
      if (value) bench.recording.stop()
      bench.setError(value)
    },
    onPauseChange: bench.setPaused,
    onReplay: () => {
      if (!bench.tearProtocol() && !bench.particle()) bench.replay()
    },
    onReset: bench.reset,
  }

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <a class={styles.brand} href="/">
          Lumen Apeiron
        </a>
        <nav aria-label="Other studies">
          <a href="/chess?view=study">Glass pawn</a>
          <a href="/figurines">Fractal figurines</a>
        </nav>
      </header>
      <div class={styles.layout}>
        <section
          class={styles.studio}
          aria-label="Gummy bear studio"
          data-ready={bench.ready()}
        >
          <div class={styles.studioHeader}>
            <span>
              {bench.particle()
                ? bench.experiment() === 'mpm'
                  ? 'MPM + marching cubes / 05'
                  : 'Particle jelly / 04'
                : bench.continuous()
                  ? bench.tearProtocol()
                    ? 'Manual tear / 03'
                    : 'Continuous jelly / 03'
                  : bench.experiment() === 'crush'
                    ? 'Crush study / 02'
                    : 'Limb pull / 01'}
            </span>
            <span>
              {bench.particle()
                ? GUMMY_STUDY_LABELS[bench.particleFixture()]
                : 'Gummy bear'}
            </span>
          </div>
          <div class={styles.canvasSlot} ref={canvasSlot}>
            <Show
              when={bench.reconstruction()}
              keyed
              fallback={
                <GummyBearScene
                  {...sceneProps}
                  experiment={bench.existingExperiment()}
                  protocol={bench.protocol()}
                />
              }
            >
              {(selected) => (
                <ParticleGummyBearScene
                  {...sceneProps}
                  reconstruction={selected}
                  caustics={bench.caustics()}
                  particleMaterial={bench.particleMaterial()}
                  fixture={bench.particleFixture()}
                  tuning={bench.tuning()}
                  grabRadius={bench.grabRadius()}
                  maxPull={bench.maxPull()}
                  pinnedFeet={bench.pinnedFeet()}
                />
              )}
            </Show>
            <Show when={bench.error()} keyed>
              {(message) => <GummyErrorNotice message={message} />}
            </Show>
          </div>
          <div class={styles.studioFooter}>
            <div
              class={styles.studioActions}
              data-testid="gummy-studio-actions"
              hidden={!bench.compactControls()}
            >
              {actions(true)}
            </div>
            <Show when={bench.compactControls()}>
              <div class={styles.studioTools}>
                <GummyBenchCameraControls bench={bench} />
                {recordingControls()}
              </div>
            </Show>
            <p>{bench.hint()}</p>
            <button
              type="button"
              class={styles.textButton}
              onClick={() => bench.setViewKey((value) => value + 1)}
            >
              Reset view
            </button>
          </div>
        </section>
        <aside class={styles.controls} aria-label="Gummy controls">
          <p class={styles.eyebrow}>Hot gummy</p>
          <h1>
            Pull it
            <br />
            apart.
          </h1>
          <p class={styles.intro}>
            Grab the gummy and pull. Adjust softness and bench.fragility, then
            reset to compare.
          </p>
          <div
            class={styles.status}
            role="status"
            aria-label="Gummy status"
            aria-live="polite"
          >
            <span class={styles.statusDot} data-ready={bench.ready()} />
            {bench.statusText()}
          </div>
          <div
            data-testid="gummy-sidebar-actions"
            hidden={bench.compactControls()}
          >
            {actions(false)}
          </div>
          <Show when={!bench.compactControls()}>
            <GummyBenchCameraControls bench={bench} />
            {recordingControls()}
          </Show>
          <Show when={bench.particle()}>
            <GummyPresetControls
              current={bench.presetSettings()}
              onApply={bench.applyPreset}
              disabled={!bench.ready() || !!bench.error()}
            />
            <p class={styles.paletteHelp}>
              <a class={styles.button} href="/gummy?view=board">
                Gummy chess board
              </a>
            </p>
            <GummyStudyControls
              fixture={bench.particleFixture()}
              disabled={!bench.ready() && !bench.error()}
              onSelect={bench.selectParticleFixture}
            />
          </Show>
          <GummyBenchControls bench={bench} />
        </aside>
      </div>
    </main>
  )
}
