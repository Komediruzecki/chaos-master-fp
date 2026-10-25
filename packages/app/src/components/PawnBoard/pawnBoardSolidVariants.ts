/** Bounded transactional uploads for two coloured connected-solid role meshes. */
import { instanceLayout } from './pawnBoardShaders'
import { solidFragment, solidLayout, solidVertex } from './pawnSolidShaders'
import type { TgpuBindGroup, TgpuRenderPass, TgpuRenderPipeline, TgpuRoot, } from 'typegpu'
import type { cameraLayout } from './pawnBoardShaders'
import type { BoardPawnInstance } from './pawnBoardTypes'

const MESH_CAPACITY = 2
const INSTANCE_CAPACITY = 32
const MAX_VERTICES = 120_000
const STRIDE = 19

function validateSolid(vertices: Float32Array) {
  if (
    !vertices.length ||
    vertices.length % (STRIDE * 3) !== 0 ||
    vertices.length / STRIDE > MAX_VERTICES ||
    !vertices.every(Number.isFinite)
  )
    throw new Error(
      'Variant solid needs finite packed triangles within capacity',
    )
  for (let offset = 0; offset < vertices.length; offset += STRIDE) {
    if (
      Math.hypot(
        vertices[offset + 3]!,
        vertices[offset + 4]!,
        vertices[offset + 5]!,
      ) < 1e-6
    )
      throw new Error('Variant solid normals must be nonzero')
    for (let axis = 6; axis < 9; axis++)
      if (vertices[offset + axis]! < 0 || vertices[offset + axis]! > 1)
        throw new Error(
          'Variant solid colour must be linear RGB within zero and one',
        )
    const radius = vertices[offset + 18]!
    if (
      radius <= 0 ||
      Math.hypot(
        vertices[offset]!,
        vertices[offset + 1]!,
        vertices[offset + 2]!,
      ) >
        radius + 0.00001
    )
      throw new Error(
        'Variant solid support radius must contain its local vertices',
      )
  }
}

export function createPawnBoardSolidVariants(
  root: TgpuRoot,
  camera: TgpuBindGroup<typeof cameraLayout.entries>,
  writeInstance: (
    data: Float32Array,
    index: number,
    piece: BoardPawnInstance,
  ) => void,
) {
  let pipeline: TgpuRenderPipeline | undefined

  function getPipeline() {
    if (pipeline) return pipeline
    const candidate = root
      .createRenderPipeline({
        attribs: { ...solidLayout.attrib, ...instanceLayout.attrib },
        vertex: solidVertex,
        fragment: solidFragment,
        targets: { format: 'rgba16float' },
        primitive: { cullMode: 'back' },
        depthStencil: {
          format: 'depth24plus',
          depthCompare: 'less-equal',
          depthWriteEnabled: true,
        },
        multisample: { count: 4 },
      })
      .with(camera)
    root.unwrap(candidate)
    pipeline = candidate
    return pipeline
  }
  const variants = new Map<string, ReturnType<typeof upload>>()
  const createMesh = (count: number) =>
    root.createBuffer(solidLayout.schemaForCount(count)).$usage('vertex')
  const createInstances = () =>
    root
      .createBuffer(instanceLayout.schemaForCount(INSTANCE_CAPACITY))
      .$usage('vertex')

  function upload(vertices: Float32Array) {
    let mesh: ReturnType<typeof createMesh> | undefined
    let instances: ReturnType<typeof createInstances> | undefined
    try {
      const drawPipeline = getPipeline()
      mesh = createMesh(vertices.length / STRIDE)
      mesh.write(new Float32Array(vertices).buffer)
      instances = createInstances()
      root.unwrap(mesh)
      root.unwrap(instances)
      const meshBuffer = mesh,
        instanceBuffer = instances
      return {
        vertexCount: vertices.length / STRIDE,
        count: 0,
        data: new Float32Array(INSTANCE_CAPACITY * 12),
        instances: instanceBuffer,
        pipeline: drawPipeline
          .with(solidLayout, meshBuffer)
          .with(instanceLayout, instanceBuffer),
        destroy() {
          meshBuffer.destroy()
          instanceBuffer.destroy()
        },
      }
    } catch (error) {
      mesh?.destroy()
      instances?.destroy()
      throw error
    }
  }

  return {
    set(key: string, vertices: Float32Array) {
      if (!key.trim()) throw new Error('A variant solid needs a nonempty key')
      if (!variants.has(key) && variants.size >= MESH_CAPACITY)
        throw new Error('Board variant solid capacity exceeded')
      validateSolid(vertices)
      const next = upload(vertices)
      variants.get(key)?.destroy()
      variants.set(key, next)
    },
    prepare(pieces: readonly BoardPawnInstance[]) {
      for (const variant of variants.values()) variant.count = 0
      for (const piece of pieces) {
        if (piece.solidKey === undefined) continue
        if (!Number.isFinite(piece.age))
          throw new Error('Board solid fracture age must be finite')
        const variant = variants.get(piece.solidKey)
        if (!variant)
          throw new Error(`Missing board variant solid: ${piece.solidKey}`)
        if (variant.count >= INSTANCE_CAPACITY)
          throw new Error('Board solid instance capacity exceeded')
        writeInstance(variant.data, variant.count++, piece)
      }
    },
    write() {
      for (const variant of variants.values())
        if (variant.count) variant.instances.write(variant.data.buffer)
    },
    draw(pass: TgpuRenderPass) {
      for (const variant of variants.values())
        if (variant.count)
          variant.pipeline.with(pass).draw(variant.vertexCount, variant.count)
    },
    clear() {
      for (const variant of variants.values()) variant.destroy()
      variants.clear()
    },
  }
}
