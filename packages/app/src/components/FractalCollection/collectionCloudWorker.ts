/** Sample native roles and fit their shared glass off the UI thread, transferring render arrays. */
import { sampleFlameFigurineCloud } from '@/flame/chess/flameFigurineCloud'
import { buildFractalChessFlame, getFractalChessCollection, } from '@/flame/chess/fractalChessCollections'
import { buildFractalStudyGlass, getFractalStudyGlassRole, } from '@/flame/chess/fractalStudyGlass'
import { assembledWindowRookPoints, buildWindowRookFracture, } from '@/flame/chess/windowRookFracture'
import type { FractalStudyGlass } from '@/flame/chess/fractalStudyGlass'
import type { PawnSide } from '@/flame/chess/pawnFlame'
import type { WindowRookFracture } from '@/flame/chess/windowRookFracture'

export type CollectionCloudRequest = {
  count: number
  collectionId: string
  /** Opt-in for native matches and Cinema; collection galleries keep their existing cost. */
  includeSolids?: boolean
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
  | {
      clouds: CollectionCloud[]
      shell?: FractalStudyGlass
      solids?: WindowRookFracture[]
      solidShell?: FractalStudyGlass
      solidError?: string
    }
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
    let solids: WindowRookFracture[] | undefined,
      solidShell: FractalStudyGlass | undefined,
      solidError: string | undefined
    if (
      event.data.includeSolids &&
      event.data.collectionId === 'lattice-court'
    ) {
      try {
        solids = shellClouds.map((cloud) =>
          buildWindowRookFracture(cloud.key, cloud.points, cloud.colors),
        )
        solidShell = buildFractalStudyGlass(
          event.data.collectionId,
          assembledWindowRookPoints(solids),
        )
      } catch (error) {
        // The ordinary point/glass comparison remains usable if this stricter
        // finite-volume prototype refuses a future disconnected source.
        solids = undefined
        solidShell = undefined
        solidError =
          error instanceof Error
            ? error.message
            : 'Could not prepare the connected-solid study.'
      }
    }
    globalThis.self.postMessage(
      {
        clouds,
        shell,
        solids,
        solidShell,
        solidError,
      } satisfies CollectionCloudReply,
      {
        transfer: [
          ...clouds.flatMap((cloud) => [
            cloud.points.buffer,
            cloud.colors.buffer,
          ]),
          ...(shell ? [shell.vertices.buffer] : []),
          ...(solids ?? []).flatMap((solid) => [
            solid.vertices.buffer,
            ...solid.physics.chunks.flatMap((chunk) => [
              chunk.boxes.buffer,
              chunk.supportPoints.buffer,
            ]),
          ]),
          ...(solidShell ? [solidShell.vertices.buffer] : []),
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
