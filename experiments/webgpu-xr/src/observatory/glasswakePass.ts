// Two bounded instanced draws reuse static shard geometry and sortable instance records.
import { d } from 'typegpu'
import { createGlasswakeGeometry, GLASSWAKE_INSTANCE_FLOATS, GLASSWAKE_SHARD_COUNT, GLASSWAKE_VERTEX_FLOATS, GLASSWAKE_VERTICES_PER_SHARD, writeGlasswakeInstance, } from './glasswakeGeometry'
import { glasswakeFragment, glasswakeGlitterFragment, glasswakeGlitterVertex, GlasswakeInstance, glasswakeLayout, GlasswakeVertex, glasswakeVertex, } from './glasswakeShaders'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { GlassPoint, GlasswakeFrame } from './glasswakeGeometry'

export type { GlasswakeFrame } from './glasswakeGeometry'

/** The caller owns the shared camera/device and draws this after opaque meshes and orbs. */
export function createGlasswakePass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
) {
  const owned: { destroy(): void }[] = []
  try {
    const geometry = createGlasswakeGeometry()
    if (
      d.sizeOf(GlasswakeVertex) !== GLASSWAKE_VERTEX_FLOATS * 4 ||
      d.sizeOf(GlasswakeInstance) !== GLASSWAKE_INSTANCE_FLOATS * 4
    )
      throw new Error(
        'Glasswake packed geometry no longer matches the GPU schema.',
      )
    const vertices = root
      .createBuffer(
        d.arrayOf(
          GlasswakeVertex,
          GLASSWAKE_SHARD_COUNT * GLASSWAKE_VERTICES_PER_SHARD,
        ),
      )
      .$usage('storage')
    owned.push(vertices)
    vertices.write(geometry.vertices.buffer)
    const instances = root
      .createBuffer(d.arrayOf(GlasswakeInstance, GLASSWAKE_SHARD_COUNT))
      .$usage('storage')
    owned.push(instances)
    const group = root.createBindGroup(glasswakeLayout, {
      camera,
      vertices,
      instances,
    })
    const glass = root
      .createRenderPipeline({
        vertex: glasswakeVertex,
        fragment: glasswakeFragment,
        targets: {
          format: 'rgba16float',
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        multisample: { count: 4 },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: false,
          depthCompare: 'less-equal',
        },
      })
      .with(group)
    const glitter = root
      .createRenderPipeline({
        vertex: glasswakeGlitterVertex,
        fragment: glasswakeGlitterFragment,
        targets: {
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
        multisample: { count: 4 },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: false,
          depthCompare: 'less-equal',
        },
      })
      .with(group)
    root.unwrap(glass)
    root.unwrap(glitter)
    const records = new Float32Array(
      GLASSWAKE_SHARD_COUNT * GLASSWAKE_INSTANCE_FLOATS,
    )
    const sorted = new Float32Array(records.length)
    const order = new Uint32Array(GLASSWAKE_SHARD_COUNT)
    const distances = new Float64Array(GLASSWAKE_SHARD_COUNT)
    let disposed = false
    let activeShards = 0
    let drawCalls = 0
    let triangles = 0
    return {
      draw(
        pass: GPURenderPassEncoder,
        frame: GlasswakeFrame,
        eye?: GlassPoint,
      ) {
        if (disposed) return
        activeShards = 0
        drawCalls = 0
        triangles = 0
        let hasGlitter = false
        const eyeX = eye?.[0] ?? frame.center[0]
        const eyeY = eye?.[1] ?? frame.center[1]
        const eyeZ = eye?.[2] ?? frame.center[2] + 3
        const viewX = frame.center[0] - eyeX
        const viewY = frame.center[1] - eyeY
        const viewZ = frame.center[2] - eyeZ
        for (let index = 0; index < geometry.shards.length; index++) {
          const offset = index * GLASSWAKE_INSTANCE_FLOATS
          if (
            !writeGlasswakeInstance(
              geometry.shards[index],
              index,
              frame,
              records,
              offset,
            )
          )
            continue
          const dx = records[offset + 12] - eyeX
          const dy = records[offset + 13] - eyeY
          const dz = records[offset + 14] - eyeZ
          distances[index] = dx * viewX + dy * viewY + dz * viewZ
          // Insertion sort avoids allocating per-frame objects or rebuilding mesh data.
          let place = activeShards
          while (place > 0 && distances[order[place - 1]] < distances[index]) {
            order[place] = order[place - 1]
            place--
          }
          order[place] = index
          activeShards++
          if (records[offset + 22] > 0.22 && !frame.clay) hasGlitter = true
        }
        if (!activeShards) return
        for (let instance = 0; instance < activeShards; instance++)
          for (let field = 0; field < GLASSWAKE_INSTANCE_FLOATS; field++)
            sorted[instance * GLASSWAKE_INSTANCE_FLOATS + field] =
              records[order[instance] * GLASSWAKE_INSTANCE_FLOATS + field]
        instances.write(sorted.buffer)
        glass.with(pass).draw(GLASSWAKE_VERTICES_PER_SHARD, activeShards)
        drawCalls = 1
        triangles = activeShards * 8
        if (hasGlitter) {
          glitter.with(pass).draw(6, activeShards)
          drawCalls++
          triangles += activeShards * 2
        }
      },
      stats() {
        return {
          bytes: geometry.bytes + sorted.byteLength,
          triangles,
          geometryTriangles: geometry.triangles,
          shards: GLASSWAKE_SHARD_COUNT,
          visibleShards: activeShards,
          drawCalls,
          material: 'Fresnel alpha approximation; no refraction',
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        for (const resource of owned) resource.destroy()
        activeShards = 0
        drawCalls = 0
        triangles = 0
      },
    }
  } catch (error) {
    for (const resource of owned) resource.destroy()
    throw error
  }
}
