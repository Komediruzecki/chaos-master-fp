// Puts back the audio wiring a loaded flame carried: a share link, a Recents
// entry, a flame file. Wiring is rows, not audio, so this never switches audio
// on.
import { executeCommand } from '@/commands/registry'
import type { CommandContext } from '@/commands/types'
import type { AudioMapping } from '@/flame/schema/audioWiring'

/**
 * Make `wiring` the workspace's wiring. A flame that carries none keeps the
 * wiring the workspace has. The command keeps audio running only when it
 * already was, on a source still loaded, and a recording replays the rows.
 */
export function restoreLoadedAudioWiring(
  ctx: CommandContext,
  wiring: AudioMapping | undefined,
): void {
  if (!wiring) return
  executeCommand('audio.setMapping', ctx, wiring)
}
