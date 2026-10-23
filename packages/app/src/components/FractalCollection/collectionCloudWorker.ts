/** Sample complete native flame roles off the UI thread and transfer only render arrays. */
import { sampleFlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import { buildFractalChessFlame, getFractalChessCollection, } from '@/flame/chess/fractalChessCollections'
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
  | { clouds: CollectionCloud[] }
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
    globalThis.self.postMessage({ clouds } satisfies CollectionCloudReply, {
      transfer: clouds.flatMap((cloud) => [
        cloud.points.buffer,
        cloud.colors.buffer,
      ]),
    })
  } catch (error) {
    globalThis.self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : 'Could not prepare this collection.',
    } satisfies CollectionCloudReply)
  }
}
