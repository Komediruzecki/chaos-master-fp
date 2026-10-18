// Retained temple meshes share the observatory device, material pass and disposal lifetime.
import { mat4 } from 'wgpu-matrix'
import { createModelPass } from './modelPass'
import { createTempleConnections, createTempleParts, EMPTY_TEMPLE_STATS, TEMPLE_CENTER, templePartVisible, } from './temple'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { TemplePresentation, TempleStats } from './temple'

export function createTemplePass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
) {
  const parts = createTempleParts().map((part) => ({
    ...part,
    model: createModelPass(root, camera, part.geometry),
  }))
  const connections = createTempleConnections().map((connection) => ({
    ...connection,
    model: createModelPass(root, camera, connection.geometry),
  }))
  const matrix = mat4.translation(TEMPLE_CENTER)
  const tint = new Float32Array([1, 1, 1, 0])
  let stats: TempleStats = { ...EMPTY_TEMPLE_STATS, totalParts: parts.length }
  return {
    draw(
      pass: GPURenderPassEncoder,
      state: TemplePresentation,
      motion: boolean,
    ) {
      stats = { ...EMPTY_TEMPLE_STATS, totalParts: parts.length }
      if (!state.active) return
      for (const part of parts) {
        if (!templePartVisible(part, state, motion)) continue
        // Reduced motion changes color only. The dark architecture is legible before its cue.
        const arrived = state.revealed || state.progress >= part.start
        const intensity = arrived ? 1 : 0.48
        tint.set([
          intensity,
          intensity,
          intensity,
          part.kind === 'seal' && state.revealed ? 0.7 : arrived ? 0.08 : 0.01,
        ])
        part.model.draw(pass, part.id, matrix, tint)
        stats.renderedParts++
        stats.visibleTriangles += part.model.triangles
      }
      for (const connection of connections) {
        if (motion && !state.revealed && state.progress < connection.start)
          continue
        const lit = state.revealed || state.progress >= connection.start
        tint.set([lit ? 1 : 0.4, lit ? 1 : 0.4, lit ? 1 : 0.4, lit ? 0.15 : 0])
        connection.model.draw(pass, connection.id, matrix, tint)
        stats.connectionSegments++
        stats.visibleTriangles += connection.model.triangles
      }
      stats.sealLit = state.revealed
    },
    stats: () => ({ ...stats }),
    get bytes() {
      return [...parts, ...connections].reduce(
        (sum, item) => sum + item.model.bytes,
        0,
      )
    },
    dispose() {
      for (const item of [...parts, ...connections]) item.model.dispose()
    },
  }
}
