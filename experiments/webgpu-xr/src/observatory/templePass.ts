// Retained temple meshes share the observatory device, material pass and disposal lifetime.
import { d } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { createModelPass } from './modelPass'
import { createTempleConnections, createTempleParts, EMPTY_TEMPLE_STATS, TEMPLE_CENTER, templePartVisible, } from './temple'
import { templeFragment, TempleLighting, templeLighting, templeMaterialLayout, } from './templeMaterial'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { TemplePresentation, TempleStats } from './temple'

export function createTemplePass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
) {
  const lighting = root.createBuffer(TempleLighting).$usage('uniform')
  const retained: ReturnType<typeof createModelPass>[] = []
  try {
    const bindGroup = root.createBindGroup(templeMaterialLayout, { lighting })
    const material = { fragment: templeFragment, bindGroup }
    const upload = (geometry: Parameters<typeof createModelPass>[2]) => {
      const model = createModelPass(root, camera, geometry, material)
      retained.push(model)
      return model
    }
    const parts = createTempleParts().map((part) => ({
      ...part,
      model: upload(part.geometry),
    }))
    const connections = createTempleConnections().map((connection) => ({
      ...connection,
      model: upload(connection.geometry),
    }))
    const matrix = mat4.translation(TEMPLE_CENTER)
    const tint = new Float32Array([1, 1, 1, 0])
    const lightingRaw = new Float32Array(4)
    let disposed = false
    let stats: TempleStats = { ...EMPTY_TEMPLE_STATS, totalParts: parts.length }
    return {
      draw(
        pass: GPURenderPassEncoder,
        state: TemplePresentation,
        motion: boolean,
      ) {
        stats = { ...EMPTY_TEMPLE_STATS, totalParts: parts.length }
        if (!state.active || disposed) return
        const lights = templeLighting(state)
        lightingRaw.set([
          lights.warm,
          lights.cool,
          lights.confluence,
          lights.seal,
        ])
        lighting.write(lightingRaw.buffer)
        for (const part of parts) {
          if (!templePartVisible(part, state, motion)) continue
          // Reduced motion changes color only. The dark architecture is legible before its cue.
          const arrived = state.revealed || state.progress >= part.start
          const intensity = arrived ? 1 : 0.48
          tint.set([
            intensity,
            intensity,
            intensity,
            part.kind === 'seal' ? lights.seal * 0.8 : 0,
          ])
          part.model.draw(pass, part.id, matrix, tint)
          stats.renderedParts++
          stats.visibleTriangles += part.model.triangles
        }
        for (const connection of connections) {
          if (motion && !state.revealed && state.progress < connection.start)
            continue
          const lit = state.revealed || state.progress >= connection.start
          tint.set([
            lit ? 1 : 0.4,
            lit ? 1 : 0.4,
            lit ? 1 : 0.4,
            lit ? 0.06 : 0,
          ])
          connection.model.draw(pass, connection.id, matrix, tint)
          stats.connectionSegments++
          stats.visibleTriangles += connection.model.triangles
        }
        stats.sealLit = state.revealed
      },
      stats: () => ({ ...stats }),
      get bytes() {
        return retained.reduce(
          (sum, model) => sum + model.bytes,
          d.sizeOf(TempleLighting),
        )
      },
      dispose() {
        if (disposed) return
        disposed = true
        for (const model of retained) model.dispose()
        lighting.destroy()
      },
    }
  } catch (error) {
    for (const model of retained) model.dispose()
    lighting.destroy()
    throw error
  }
}
