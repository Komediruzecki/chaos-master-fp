/** Bounded CPU validation for GPU chunk identities and baked motion payloads. */
import { ROOK_CONTACT_MAX_FRAMES } from '@/flame/chess/rookContactTypes'
import type { RookContactMotion } from '@/flame/chess/rookContactTypes'
import type { RookChunk } from '@/flame/chess/windowRookFractureMesh'

export function contactChunkIds(
  vertexCount: number,
  chunks: readonly RookChunk[],
) {
  if (!chunks.length || chunks.length > 32)
    throw new Error('Contact solid needs one to 32 chunks')
  const ids = new Uint32Array(vertexCount)
  let end = 0
  for (const [index, chunk] of chunks.entries()) {
    if (
      chunk.firstVertex !== end ||
      !Number.isInteger(chunk.vertexCount) ||
      chunk.vertexCount <= 0 ||
      chunk.vertexCount % 3 !== 0
    )
      throw new Error('Contact chunk ranges must cover contiguous triangles')
    end += chunk.vertexCount
    if (end > vertexCount)
      throw new Error('Contact chunk range exceeds its mesh')
    ids.fill(index, chunk.firstVertex, end)
  }
  if (end !== vertexCount)
    throw new Error('Contact chunk ranges must cover the entire mesh')
  return ids
}

export function validateContactMotion(motion: RookContactMotion) {
  if (
    !Number.isInteger(motion.chunkCount) ||
    motion.chunkCount < 1 ||
    motion.chunkCount > 32 ||
    !Number.isInteger(motion.frameCount) ||
    motion.frameCount < 2 ||
    motion.frameCount > ROOK_CONTACT_MAX_FRAMES ||
    !Number.isFinite(motion.sampleRate) ||
    motion.sampleRate <= 0 ||
    motion.sampleRate > 1000 ||
    motion.poses.length !== motion.chunkCount * motion.frameCount * 8 ||
    !motion.poses.every(Number.isFinite)
  )
    throw new Error('Contact motion must contain bounded finite pose samples')
  for (let index = 0; index < motion.poses.length; index += 8) {
    const length = Math.hypot(
      motion.poses[index + 4]!,
      motion.poses[index + 5]!,
      motion.poses[index + 6]!,
      motion.poses[index + 7]!,
    )
    if (Math.abs(length - 1) > 0.001)
      throw new Error('Contact motion rotations must be unit quaternions')
  }
}
