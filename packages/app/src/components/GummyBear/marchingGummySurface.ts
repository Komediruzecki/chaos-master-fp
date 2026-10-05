/** Owned GPU marching-cubes surface: bounded particle scatter, mesh append and indirect draw, without frame readback. */
import { d } from 'typegpu'
import { MARCHING_GUMMY_CELL_SCALE, MARCHING_GUMMY_FIXED_SCALE, MARCHING_GUMMY_ISO, MARCHING_GUMMY_MAX_VERTICES, MARCHING_GUMMY_MEMORY_LIMIT, MARCHING_GUMMY_RADIUS_SCALE, marchingGummyDomain, marchingGummyGrid, } from './marchingGummyMath'
import { MarchingGummyAccumulation, marchingGummyFinalize, marchingGummyLayout, MarchingGummyNode, marchingGummyNormalize, MarchingGummyParameters, marchingGummyPolygonize, marchingGummyScatter, MarchingGummyVertex, } from './marchingGummySurfaceShaders'
import { MARCHING_GUMMY_TRIANGLES } from './marchingGummyTables'
import type { StorageFlag, TgpuBuffer, TgpuRoot } from 'typegpu'

export type MarchingGummyInput = {
  positions: TgpuBuffer<d.WgslArray<d.Vec4f>> & StorageFlag
  restPositions: Float32Array
  dyePositions?: Float32Array
  particleCount: number
  spacing: number
  gridBounds: { min: readonly number[]; max: readonly number[] }
  cellSize?: number
  isoLevel?: number
  maxVertices?: number
}

export function createMarchingGummySurface(
  root: TgpuRoot,
  device: GPUDevice,
  input: MarchingGummyInput,
) {
  if (root.device !== device)
    throw new Error('Marching-cubes root and device must match')
  const { spacing, particleCount } = input
  if (
    !Number.isFinite(spacing) ||
    spacing <= 0 ||
    !Number.isSafeInteger(particleCount) ||
    particleCount < 1
  )
    throw new Error(
      'Marching-cubes particles require finite positive spacing and count',
    )
  const radius = spacing * MARCHING_GUMMY_RADIUS_SCALE
  const volumeWeight = spacing ** 3 / ((4 * Math.PI * radius ** 3) / 3)
  // Even complete collapse into one node cannot wrap a u32 accumulator.
  const maximumParticleContribution = Math.ceil(
    (35 / 8) * volumeWeight * MARCHING_GUMMY_FIXED_SCALE,
  )
  if (particleCount * maximumParticleContribution > 0xffffffff)
    throw new Error(
      'Marching-cubes particle count exceeds the exact accumulator capacity',
    )
  const cellSize = input.cellSize ?? spacing * MARCHING_GUMMY_CELL_SCALE
  const isoLevel = input.isoLevel ?? MARCHING_GUMMY_ISO
  if (!Number.isFinite(isoLevel) || isoLevel <= 0)
    throw new Error(
      'Marching-cubes density threshold must be finite and positive',
    )
  const gridBounds = marchingGummyDomain(input.gridBounds, radius)
  const grid = marchingGummyGrid(
    gridBounds,
    cellSize,
    input.maxVertices ?? MARCHING_GUMMY_MAX_VERTICES,
  )
  const bytes = grid.bytes + particleCount * 16
  if (bytes > MARCHING_GUMMY_MEMORY_LIMIT)
    throw new Error(
      'Marching-cubes grid and dye exceed the 96 MiB surface memory budget',
    )
  const dye = input.dyePositions ?? input.restPositions
  if (dye.length !== particleCount * 4 || !dye.every(Number.isFinite))
    throw new Error(
      'Marching-cubes dye coordinates must contain one finite vec4 per particle',
    )
  const dyeMin = [Infinity, Infinity, Infinity]
  const dyeMax = [-Infinity, -Infinity, -Infinity]
  for (let particle = 0; particle < particleCount; particle++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = dye[particle * 4 + axis]!
      dyeMin[axis] = Math.min(dyeMin[axis]!, value)
      dyeMax[axis] = Math.max(dyeMax[axis]!, value)
    }
  }
  const dyeRange = dyeMax.map((value, axis) =>
    Math.max(0.000001, value - dyeMin[axis]!),
  )
  const owned: { destroy(): void }[] = []
  const own = <T extends { destroy(): void }>(resource: T): T => {
    owned.push(resource)
    return resource
  }
  try {
    const rest = own(
      root
        .createBuffer(d.arrayOf(d.vec4f, particleCount), (mapped) => {
          mapped.write(dye)
        })
        .$usage('storage'),
    )
    const accumulations = own(
      root
        .createBuffer(d.arrayOf(MarchingGummyAccumulation, grid.nodeCount))
        .$usage('storage'),
    )
    const nodes = own(
      root
        .createBuffer(d.arrayOf(MarchingGummyNode, grid.nodeCount))
        .$usage('storage'),
    )
    const triangles = own(
      root
        .createBuffer(
          d.arrayOf(d.i32, MARCHING_GUMMY_TRIANGLES.length),
          (mapped) => {
            mapped.write(MARCHING_GUMMY_TRIANGLES)
          },
        )
        .$usage('storage'),
    )
    const vertices = own(
      root
        .createBuffer(d.arrayOf(MarchingGummyVertex, grid.capacity))
        .$usage('storage'),
    )
    const counter = own(root.createBuffer(d.atomic(d.u32)).$usage('storage'))
    const indirect = own(
      root.createBuffer(d.arrayOf(d.u32, 4)).$usage('storage', 'indirect'),
    )
    const params = own(
      root
        .createBuffer(MarchingGummyParameters, {
          originCell: d.vec4f(
            gridBounds.min[0]!,
            gridBounds.min[1]!,
            gridBounds.min[2]!,
            cellSize,
          ),
          dimensions: d.vec4u(
            grid.gridSize[0]!,
            grid.gridSize[1]!,
            grid.gridSize[2]!,
            grid.nodeCount,
          ),
          counts: d.vec4u(particleCount, grid.capacity, grid.cellCount, 0),
          density: d.vec4f(
            radius,
            volumeWeight,
            isoLevel,
            MARCHING_GUMMY_FIXED_SCALE,
          ),
          dyeMin: d.vec4f(dyeMin[0]!, dyeMin[1]!, dyeMin[2]!, 0),
          dyeRange: d.vec4f(dyeRange[0]!, dyeRange[1]!, dyeRange[2]!, 0),
        })
        .$usage('uniform'),
    )
    const group = root.createBindGroup(marchingGummyLayout, {
      params,
      positions: input.positions,
      rest,
      accumulations,
      nodes,
      triangles,
      vertices,
      counter,
      indirect,
    })
    const scatter = root
      .createComputePipeline({ compute: marchingGummyScatter })
      .with(group)
    const normalize = root
      .createComputePipeline({ compute: marchingGummyNormalize })
      .with(group)
    const polygonize = root
      .createComputePipeline({ compute: marchingGummyPolygonize })
      .with(group)
    const finalize = root
      .createComputePipeline({ compute: marchingGummyFinalize })
      .with(group)
    for (const pipeline of [scatter, normalize, polygonize, finalize])
      root.unwrap(pipeline)
    const rawAccumulations = root.unwrap(accumulations)
    const rawCounter = root.unwrap(counter)
    let disposed = false
    return {
      vertices,
      indirect,
      cellSize,
      gridBounds,
      gridSize: grid.gridSize,
      maxVertices: grid.capacity,
      radius,
      isoLevel,
      bytes,
      encode(encoder: GPUCommandEncoder) {
        if (disposed) return
        encoder.clearBuffer(rawAccumulations)
        encoder.clearBuffer(rawCounter)
        const pass = encoder.beginComputePass({
          label: 'Marching-cubes particle density and surface',
        })
        scatter.with(pass).dispatchWorkgroups(Math.ceil(particleCount / 64))
        normalize.with(pass).dispatchWorkgroups(Math.ceil(grid.nodeCount / 64))
        polygonize.with(pass).dispatchWorkgroups(Math.ceil(grid.cellCount / 64))
        finalize.with(pass).dispatchWorkgroups(1)
        pass.end()
      },
      /** Explicit diagnostics only; rendering and indirect draw never await a GPU readback. */
      async readStats() {
        if (disposed)
          throw new Error('Marching-cubes surface has been destroyed')
        const [attemptedVertices, draw] = await Promise.all([
          counter.read(),
          indirect.read(),
        ])
        return {
          vertexCount: draw[0]!,
          triangleCount: draw[0]! / 3,
          attemptedVertices,
          overflow: attemptedVertices > grid.capacity,
          droppedVertices: Math.max(0, attemptedVertices - grid.capacity),
          capacity: grid.capacity,
          cellSize,
          gridBounds,
          gridSize: grid.gridSize,
          bytes,
        }
      },
      destroy() {
        if (disposed) return
        disposed = true
        for (const resource of owned.reverse()) resource.destroy()
      },
    }
  } catch (error) {
    for (const resource of owned.reverse()) resource.destroy()
    throw error
  }
}
