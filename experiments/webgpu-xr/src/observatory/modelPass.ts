// Upload each factor-material mesh once, with a reusable uniform per scene instance.
import { d } from 'typegpu'
import { mat4 } from 'wgpu-matrix'
import { bookFragment, bookLayout, bookVertexLayout, } from '../almanac/bookShaders'
import { Model, modelLayout, modelVertex } from './shaders'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { BookGeometry } from '../almanac/bookAsset'
import type { View } from '../bench/shaders'

export function createModelPass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
  geometry: BookGeometry,
) {
  const buffers: { destroy(): void }[] = []
  try {
    const vertices = root
      .createBuffer(
        bookVertexLayout.schemaForCount(geometry.vertices.length / 16),
      )
      .$usage('vertex')
    buffers.push(vertices)
    const indices = root
      .createBuffer(d.arrayOf(d.u32, geometry.indices.length))
      .$usage('index')
    buffers.push(indices)
    vertices.write(geometry.vertices.buffer)
    indices.write(geometry.indices.buffer)
    const pipeline = root
      .createRenderPipeline({
        attribs: { ...bookVertexLayout.attrib },
        vertex: modelVertex,
        fragment: bookFragment,
        targets: { format: 'rgba16float' },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        multisample: { count: 4 },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      })
      .with(root.createBindGroup(bookLayout, { camera }))
      .with(bookVertexLayout, vertices)
      .withIndexBuffer(indices)
    const instances = new Map<string, ReturnType<typeof createInstance>>()

    function createInstance() {
      const uniform = root.createBuffer(Model).$usage('uniform')
      try {
        return {
          uniform,
          group: root.createBindGroup(modelLayout, { model: uniform }),
          raw: new Float32Array(d.sizeOf(Model) / 4),
        }
      } catch (error) {
        uniform.destroy()
        throw error
      }
    }
    root.unwrap(pipeline)
    return {
      triangles: geometry.triangles,
      get bytes() {
        return (
          geometry.vertices.byteLength +
          geometry.indices.byteLength +
          instances.size * d.sizeOf(Model)
        )
      },
      draw(
        pass: GPURenderPassEncoder,
        id: string,
        matrix: ArrayLike<number>,
        tint: readonly number[] = [1, 1, 1, 0],
      ) {
        let instance = instances.get(id)
        if (!instance) {
          instance = createInstance()
          instances.set(id, instance)
        }
        instance.raw.set(matrix, 0)
        instance.raw.set(tint, 16)
        instance.uniform.write(instance.raw.buffer)
        pipeline
          .with(instance.group)
          .with(pass)
          .drawIndexed(geometry.indices.length)
      },
      dispose() {
        for (const instance of instances.values()) instance.uniform.destroy()
        instances.clear()
        for (const buffer of buffers) buffer.destroy()
      },
    }
  } catch (error) {
    for (const buffer of buffers) buffer.destroy()
    throw error
  }
}

/** Reusable opaque primitives use the same material path as the authored GLBs. */
export function primitiveGeometry(
  kind: 'sphere' | 'ring' | 'beam',
): BookGeometry {
  const vertices: number[] = []
  const indices: number[] = []
  const push = (p: number[], n: number[]) =>
    vertices.push(...p, 1, ...n, 0, 0.8, 0.66, 0.4, 1, 0.68, 0.35, 0, 1)
  if (kind === 'beam') {
    const faces = [
      [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
        [0, 0, 1],
      ],
      [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
        [0, 0, -1],
      ],
      [
        [1, -1, 1],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, 0, 0],
      ],
      [
        [-1, -1, -1],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, 0, 0],
      ],
      [
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
        [-1, 1, -1],
        [0, 1, 0],
      ],
      [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
        [0, -1, 0],
      ],
    ]
    faces.forEach((face, i) => {
      face.slice(0, 4).forEach((point) => push(point, face[4]))
      const b = i * 4
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
    })
  } else {
    const around = kind === 'ring' ? 96 : 24
    const across = kind === 'ring' ? 8 : 16
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * Math.PI * 2
      for (let j = 0; j <= across; j++) {
        const b = (j / across) * (kind === 'ring' ? Math.PI * 2 : Math.PI)
        if (kind === 'ring') {
          const n = [
            Math.cos(a) * Math.cos(b),
            Math.sin(b),
            Math.sin(a) * Math.cos(b),
          ]
          push(
            [
              Math.cos(a) * (1 + 0.009 * Math.cos(b)),
              0.009 * Math.sin(b),
              Math.sin(a) * (1 + 0.009 * Math.cos(b)),
            ],
            n,
          )
        } else {
          const p = [
            Math.cos(a) * Math.sin(b),
            Math.cos(b),
            Math.sin(a) * Math.sin(b),
          ]
          push(p, p)
        }
        if (i < around && j < across) {
          const k = i * (across + 1) + j
          if (kind === 'ring')
            indices.push(
              k,
              k + 1,
              k + across + 1,
              k + 1,
              k + across + 2,
              k + across + 1,
            )
          else
            indices.push(
              k,
              k + across + 1,
              k + 1,
              k + 1,
              k + across + 1,
              k + across + 2,
            )
        }
      }
    }
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
    bytes: 0,
    materials: ['Procedural brass'],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    anchors: {},
  }
}

/** A beam's local +Z axis joins endpoints; the rotation has unit determinant. */
export function beamMatrix(
  from: readonly number[],
  to: readonly number[],
  radius: number,
) {
  const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const length = Math.hypot(...delta)
  const center = from.map((value, i) => (value + to[i]) / 2)
  const matrix = mat4.cameraAim(
    center,
    to,
    Math.abs(delta[1]) / Math.max(length, 1e-6) > 0.99 ? [1, 0, 0] : [0, 1, 0],
  )
  mat4.scale(matrix, [radius, radius, Math.max(length / 2, 0.001)], matrix)
  return matrix
}
