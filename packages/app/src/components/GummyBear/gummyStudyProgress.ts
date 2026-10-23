/** Converts benchmark progress into presentation status and its completion boundary. */
import { GUMMY_CRUSH_SECONDS, GUMMY_DEMO_SECONDS, GUMMY_JELLY_SECONDS, GUMMY_STEP, } from './gummyStudyMath'
import type { GummyStudyStatus, NativeGummyStudyProps, } from './gummyStudyContracts'
import type { GummyBenchmarkPhase } from './gummyStudyMath'

export function gummyStudyProgress(
  props: NativeGummyStudyProps,
  benchmarkPhase: GummyBenchmarkPhase | 'idle',
  time: number,
  steps: number,
): { status: GummyStudyStatus; finished: boolean } {
  const continuous = props.experiment === 'jelly'
  const tearProtocol = continuous && props.protocol === 'tear'
  let result: GummyStudyStatus = 'ready'
  const status = (next: GummyStudyStatus) => {
    result = next
  }
  if (continuous) {
    status(
      benchmarkPhase === 'loading'
        ? props.protocol === 'squeeze'
          ? 'crushing'
          : tearProtocol
            ? 'pulling'
            : 'stretching'
        : benchmarkPhase === 'holding'
          ? 'holding'
          : benchmarkPhase === 'releasing'
            ? 'retracting'
            : 'settling',
    )
  } else if (props.experiment === 'crush') {
    status(
      time < 6.5
        ? 'crushing'
        : time < 7.05
          ? 'holding'
          : time < 8.45
            ? 'retracting'
            : 'settling',
    )
  } else status(time < 5.4 ? 'pulling' : 'settling')
  const finished = continuous
    ? steps >= Math.round(GUMMY_JELLY_SECONDS / GUMMY_STEP)
    : time >=
      (props.experiment === 'crush' ? GUMMY_CRUSH_SECONDS : GUMMY_DEMO_SECONDS)
  return { status: result, finished }
}
