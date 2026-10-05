/** Bake shared candy moulds on the GPU once, then retain only compact render meshes. */
import { d } from 'typegpu'
import { GUMMY_CHESS_MOULDS, sampleGummyChessMould, } from '@/simulation/gummy/gummyChessMoulds'
import { createMarchingGummySurface } from '../GummyBear/marchingGummySurface'
import { MarchingGummyVertex } from '../GummyBear/marchingGummySurfaceShaders'
import { GUMMY_BOARD_MOULDS } from './gummyBoardInstances'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'
import type { GummyChessMould } from '@/simulation/gummy/gummyChessMoulds'

export type GummyBoardRestMesh = {
  vertices: TgpuBuffer<d.WgslArray<typeof MarchingGummyVertex>> & StorageFlag
  vertexCount: number
  destroy(): void
}

/** Sequential baking bounds peak memory; no solver, density grid or readback survives setup. */
export async function createGummyBoardRestMeshes(
  root: TgpuRoot,
  device: GPUDevice,
  spacing: number,
) {
  const meshes = new Map<GummyChessMould, GummyBoardRestMesh>()
  try {
    for (const mould of GUMMY_BOARD_MOULDS) {
      const restPositions = new Float32Array(
        sampleGummyChessMould(mould, spacing),
      )
      const positions = root
        .createBuffer(
          d.arrayOf(d.vec4f, restPositions.length / 4),
          (mapped) => {
            mapped.write(restPositions)
          },
        )
        .$usage('storage')
      let surface: ReturnType<typeof createMarchingGummySurface> | undefined
      let compact: GummyBoardRestMesh['vertices'] | undefined
      try {
        surface = createMarchingGummySurface(root, device, {
          positions,
          restPositions,
          particleCount: restPositions.length / 4,
          spacing,
          gridBounds: GUMMY_CHESS_MOULDS[mould].bounds,
        })
        const bake = device.createCommandEncoder({
          label: `Gummy board ${mould} rest bake`,
        })
        surface.encode(bake)
        device.queue.submit([bake.finish()])
        const stats = await surface.readStats()
        if (stats.overflow || stats.vertexCount < 3)
          throw new Error(
            `Gummy board ${mould} mesh could not be baked completely`,
          )
        compact = root
          .createBuffer(d.arrayOf(MarchingGummyVertex, stats.vertexCount))
          .$usage('storage')
        const copy = device.createCommandEncoder({
          label: `Gummy board ${mould} compact mesh`,
        })
        copy.copyBufferToBuffer(
          root.unwrap(surface.vertices),
          0,
          root.unwrap(compact),
          0,
          stats.vertexCount * d.sizeOf(MarchingGummyVertex),
        )
        device.queue.submit([copy.finish()])
        await device.queue.onSubmittedWorkDone()
        const vertices = compact
        meshes.set(mould, {
          vertices,
          vertexCount: stats.vertexCount,
          destroy: () => {
            vertices.destroy()
          },
        })
      } catch (error) {
        compact?.destroy()
        throw error
      } finally {
        surface?.destroy()
        positions.destroy()
      }
    }
    let disposed = false
    return {
      meshes,
      destroy() {
        if (disposed) return
        disposed = true
        for (const mesh of meshes.values()) mesh.destroy()
      },
    }
  } catch (error) {
    for (const mesh of meshes.values()) mesh.destroy()
    throw error
  }
}
