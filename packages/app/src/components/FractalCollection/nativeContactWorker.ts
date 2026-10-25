/** Bake the bounded contact trajectory away from input and rendering; only poses return to the GPU. */
import { bakeRookContactShot } from '@/flame/chess/rookContactSolver'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'

export type NativeContactReply =
  | { motion: RookContactMotion }
  | { error: string }

globalThis.self.onmessage = (
  event: MessageEvent<Parameters<typeof bakeRookContactShot>[0]>,
) => {
  try {
    const motion = bakeRookContactShot(event.data)
    globalThis.self.postMessage({ motion } satisfies NativeContactReply, {
      transfer: [motion.poses.buffer, motion.brokenAt.buffer],
    })
  } catch (error) {
    globalThis.self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'Could not prepare this contact capture.',
    } satisfies NativeContactReply)
  }
}
