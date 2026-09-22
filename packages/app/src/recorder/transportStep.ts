/**
 * The recorded form of Play and Pause: `timeline.setPlaying(playing, frame)`.
 *
 * A leaf, like `documentWriteHook.ts`, because both ends need it and neither
 * may import the other: the command registers under this id and describes
 * itself with this label, and the recorder writes the same id and label when
 * the timeline reports a start or stop. One definition keeps a recorded step
 * and a replayed one from ever reading differently in the step list.
 */

export const TIMELINE_PLAYBACK_COMMAND_ID = 'timeline.setPlaying'

export function describeTimelinePlayback(
  playing: boolean,
  frame: number,
): string {
  return playing ? `Play from frame ${frame}` : `Pause at frame ${frame}`
}
