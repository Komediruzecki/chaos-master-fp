/** Sample native roles and fit their shared glass off the UI thread, transferring render arrays. */
import { sampleFlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import { buildFractalChessFlame, getFractalChessCollection, } from '@/flame/chess/fractalChessCollections'
import { buildFractalStudyGlass, getFractalStudyGlassRole, } from '@/flame/chess/fractalStudyGlass'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { PawnSide } from '@/flame/chess/pawnFlame'

export type CollectionCloudRequest = {
  count: number
  collectionId: string
}
export type CollectionCloud = {
  key: string
  side: PawnSide
  points: Float32Array
  colors: Float32Array
  bounds: {
    min: readonly [number, number, number]
    max: readonly [number, number, number]
  }
}
export type CollectionCloudReply =
  | { clouds: CollectionCloud[]; shell?: FractalStudyGlass }
  | { error: string }

globalThis.self.onmessage = (event: MessageEvent<CollectionCloudRequest>) => {
  try {
    const clouds = getFractalChessCollection(
      event.data.collectionId,
    ).pieces.flatMap(({ role }) =>
      (['light', 'dark'] as const).map((side): CollectionCloud => {
        const sampled = sampleFlameFigurineCloud(
          buildFractalChessFlame(event.data.collectionId, role, side),
          {
            count: event.data.count,
            seed: 42,
            lightness: 0.64,
          },
        )
        return {
          key: `${role}:${side}`,
          side,
          points: sampled.points,
          colors: sampled.colors,
          bounds: sampled.bounds,
        }
      }),
    )
    const glassRole = getFractalStudyGlassRole(event.data.collectionId)
    const shellClouds = clouds.filter(
      (cloud) =>
        cloud.key === `${glassRole}:light` || cloud.key === `${glassRole}:dark`,
    )
    let shell: FractalStudyGlass | undefined
    if (glassRole && shellClouds.length) {
      // Fit both sides together exactly as the board does. The envelope can be
      // reused for pure/glass comparisons without resampling or a second job.
      const points = new Float32Array(
        shellClouds.reduce((sum, cloud) => sum + cloud.points.length, 0),
      )
      let offset = 0
      for (const cloud of shellClouds) {
        points.set(cloud.points, offset)
        offset += cloud.points.length
      }
      shell = buildFractalStudyGlass(event.data.collectionId, points)
    }
    globalThis.self.postMessage(
      { clouds, shell } satisfies CollectionCloudReply,
      {
        transfer: [
          ...clouds.flatMap((cloud) => [
            cloud.points.buffer,
            cloud.colors.buffer,
          ]),
          ...(shell ? [shell.vertices.buffer] : []),
        ],
      },
    )
  } catch (error) {
    globalThis.self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'Could not prepare this collection.',
    } satisfies CollectionCloudReply)
  }
}
