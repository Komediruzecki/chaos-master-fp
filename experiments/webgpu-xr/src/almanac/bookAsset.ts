// Bounded loader for our Blender-exported, uncompressed, factor-material GLB.
import { mat4 } from 'wgpu-matrix'

interface Accessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  sparse?: unknown
  normalized?: boolean
}
interface BufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}
interface Primitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  mode?: number
  extensions?: unknown
  targets?: unknown
}
interface Material {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
    metallicFactor?: number
    roughnessFactor?: number
    baseColorTexture?: unknown
    metallicRoughnessTexture?: unknown
  }
  emissiveFactor?: number[]
  alphaMode?: string
  normalTexture?: unknown
  occlusionTexture?: unknown
  emissiveTexture?: unknown
  extensions?: Record<
    string,
    {
      specularFactor?: number
      specularTexture?: unknown
      specularColorFactor?: number[]
      specularColorTexture?: unknown
    }
  >
}
interface Node {
  name?: string
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  skin?: number
}
interface Gltf {
  asset: { version: string }
  buffers: { byteLength: number; uri?: string }[]
  bufferViews: BufferView[]
  accessors: Accessor[]
  meshes: { primitives: Primitive[] }[]
  materials?: Material[]
  nodes: Node[]
  scenes: { nodes: number[] }[]
  scene?: number
  extensionsRequired?: string[]
}

export interface BookGeometry {
  vertices: Float32Array<ArrayBuffer>
  indices: Uint32Array<ArrayBuffer>
  triangles: number
  bytes: number
  materials: string[]
  bounds: { min: number[]; max: number[] }
  anchors: Record<string, number[]>
}

/** This is deliberately not a general glTF loader: unsupported features fail. */
export function parseBookGlb(bytes: ArrayBuffer): BookGeometry {
  const header = new DataView(bytes)
  if (
    bytes.byteLength < 28 ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error('The Almanac model is not a complete glTF 2 binary.')
  let gltf: Gltf | undefined
  let binary: DataView | undefined
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const length = header.getUint32(offset, true)
    const kind = header.getUint32(offset + 4, true)
    if (offset + 8 + length > bytes.byteLength)
      throw new Error('Truncated Almanac model chunk.')
    if (kind === 0x4e4f534a)
      gltf = JSON.parse(
        new TextDecoder().decode(new Uint8Array(bytes, offset + 8, length)),
      ) as Gltf
    if (kind === 0x004e4942) binary = new DataView(bytes, offset + 8, length)
    offset += 8 + length
  }
  if (
    !gltf ||
    !binary ||
    gltf.asset.version !== '2.0' ||
    gltf.buffers.length !== 1 ||
    gltf.buffers[0].uri ||
    gltf.extensionsRequired?.some(
      (extension) => extension !== 'KHR_materials_specular',
    )
  )
    throw new Error(
      'The Almanac requires a self-contained, uncompressed glTF 2 model.',
    )
  const document = gltf
  const data = binary

  function read(index: number, expected: string): number[] {
    const accessor = document.accessors[index]
    if (
      !accessor ||
      accessor.type !== expected ||
      accessor.sparse ||
      accessor.normalized
    )
      throw new Error(`Unsupported Almanac accessor ${index}.`)
    const view = document.bufferViews[accessor.bufferView]
    if (!view || view.buffer !== 0)
      throw new Error('Missing Almanac geometry buffer.')
    const components = expected === 'VEC3' ? 3 : 1
    const size =
      accessor.componentType === 5126 || accessor.componentType === 5125
        ? 4
        : accessor.componentType === 5123
          ? 2
          : accessor.componentType === 5121
            ? 1
            : 0
    if (
      !size ||
      (expected === 'VEC3' && accessor.componentType !== 5126) ||
      (expected === 'SCALAR' && accessor.componentType === 5126)
    )
      throw new Error('Unsupported Almanac vertex encoding.')
    const stride = view.byteStride ?? components * size
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const end = start + (accessor.count - 1) * stride + components * size
    if (
      accessor.count < 1 ||
      accessor.count > 1000000 ||
      stride < components * size ||
      start < 0 ||
      end > (view.byteOffset ?? 0) + view.byteLength ||
      end > data.byteLength
    )
      throw new Error('Almanac geometry exceeds its buffer bounds.')
    const values = new Array<number>(accessor.count * components)
    for (let i = 0; i < accessor.count; i++)
      for (let c = 0; c < components; c++) {
        const at = start + i * stride + c * size
        const value =
          accessor.componentType === 5126
            ? data.getFloat32(at, true)
            : size === 4
              ? data.getUint32(at, true)
              : size === 2
                ? data.getUint16(at, true)
                : data.getUint8(at)
        if (!Number.isFinite(value))
          throw new Error('Non-finite Almanac geometry.')
        values[i * components + c] = value
      }
    return values
  }
  const vertices: number[] = []
  const indices: number[] = []
  const materials = new Set<string>()
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  const anchors: Record<string, number[]> = {}
  const visited = new Set<number>()

  function visit(index: number, parent: Float32Array) {
    if (visited.has(index)) throw new Error('Repeated or cyclic Almanac node.')
    visited.add(index)
    const node = document.nodes[index]
    if (!node) throw new Error('Missing Almanac scene node.')
    if (node.skin !== undefined)
      throw new Error('Skinned Almanac geometry is unsupported.')
    let local = node.matrix
      ? new Float32Array(node.matrix)
      : mat4.fromQuat(node.rotation ?? [0, 0, 0, 1])
    if (!node.matrix) {
      local = mat4.scale(local, node.scale ?? [1, 1, 1])
      local[12] = node.translation?.[0] ?? 0
      local[13] = node.translation?.[1] ?? 0
      local[14] = node.translation?.[2] ?? 0
    }
    const transform = mat4.multiply(parent, local)
    if (node.name === 'OrbDockLeft' || node.name === 'OrbDockRight')
      anchors[node.name] = [transform[12], transform[13], transform[14]]
    if (
      !Array.from(transform).every(Number.isFinite) ||
      Math.abs(mat4.determinant(transform)) < 0.000001
    )
      throw new Error('Invalid Almanac node transform.')
    const normalMatrix = mat4.transpose(mat4.inverse(transform))
    if (node.mesh !== undefined)
      for (const primitive of document.meshes[node.mesh].primitives) {
        if (
          (primitive.mode ?? 4) !== 4 ||
          primitive.extensions ||
          primitive.targets
        )
          throw new Error('The Almanac supports plain triangle meshes only.')
        const positions = read(primitive.attributes.POSITION, 'VEC3')
        const normals = read(primitive.attributes.NORMAL, 'VEC3')
        if (normals.length !== positions.length)
          throw new Error('Almanac normal count mismatch.')
        const material = document.materials?.[primitive.material ?? -1] ?? {}
        const pbr = material.pbrMetallicRoughness
        const specular = material.extensions?.KHR_materials_specular
        if (
          pbr?.baseColorTexture ||
          pbr?.metallicRoughnessTexture ||
          material.normalTexture ||
          material.occlusionTexture ||
          material.emissiveTexture ||
          (material.alphaMode && material.alphaMode !== 'OPAQUE')
        )
          throw new Error(
            'The Almanac renderer expects opaque factor materials without textures.',
          )
        if (
          Object.keys(material.extensions ?? {}).some(
            (extension) => extension !== 'KHR_materials_specular',
          ) ||
          specular?.specularTexture ||
          specular?.specularColorTexture ||
          specular?.specularColorFactor
        )
          throw new Error('Unsupported Almanac material extension.')
        materials.add(material.name ?? 'Default')
        const color = pbr?.baseColorFactor ?? [1, 1, 1, 1]
        const metal = pbr?.metallicFactor ?? 1
        const rough = pbr?.roughnessFactor ?? 1
        const emissive = Math.max(...(material.emissiveFactor ?? [0, 0, 0]))
        if (
          color.length !== 4 ||
          ![
            ...color,
            metal,
            rough,
            emissive,
            specular?.specularFactor ?? 1,
          ].every(Number.isFinite)
        )
          throw new Error('Invalid Almanac material factors.')
        const offset = vertices.length / 16
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i],
            y = positions[i + 1],
            z = positions[i + 2]
          const position = [
            transform[0] * x +
              transform[4] * y +
              transform[8] * z +
              transform[12],
            transform[1] * x +
              transform[5] * y +
              transform[9] * z +
              transform[13],
            transform[2] * x +
              transform[6] * y +
              transform[10] * z +
              transform[14],
          ]
          const nx = normals[i],
            ny = normals[i + 1],
            nz = normals[i + 2]
          const normal = [
            normalMatrix[0] * nx + normalMatrix[4] * ny + normalMatrix[8] * nz,
            normalMatrix[1] * nx + normalMatrix[5] * ny + normalMatrix[9] * nz,
            normalMatrix[2] * nx + normalMatrix[6] * ny + normalMatrix[10] * nz,
          ]
          const magnitude = Math.hypot(...normal)
          if (!(magnitude > 0)) throw new Error('Zero-length Almanac normal.')
          for (let axis = 0; axis < 3; axis++) {
            bounds.min[axis] = Math.min(bounds.min[axis], position[axis])
            bounds.max[axis] = Math.max(bounds.max[axis], position[axis])
          }
          vertices.push(
            ...position,
            1,
            ...normal.map((value) => value / magnitude),
            0,
            ...color,
            metal,
            rough,
            emissive,
            specular?.specularFactor ?? 1,
          )
        }
        const source =
          primitive.indices === undefined
            ? Array.from({ length: positions.length / 3 }, (_, i) => i)
            : read(primitive.indices, 'SCALAR')
        if (source.length % 3)
          throw new Error('Almanac index count must describe triangles.')
        const mirrored = mat4.determinant(transform) < 0
        for (let i = 0; i < source.length; i += 3) {
          const triangle = mirrored
            ? [source[i], source[i + 2], source[i + 1]]
            : source.slice(i, i + 3)
          for (const value of triangle) {
            if (
              !Number.isInteger(value) ||
              value < 0 ||
              value >= positions.length / 3
            )
              throw new Error('Almanac index exceeds vertex bounds.')
            indices.push(offset + value)
          }
        }
      }
    for (const child of node.children ?? []) visit(child, transform)
  }
  const scene = document.scenes[document.scene ?? 0]
  if (!scene) throw new Error('Missing Almanac scene.')
  for (const node of scene.nodes) visit(node, mat4.identity())
  if (!indices.length) throw new Error('The Almanac scene has no triangles.')
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
    bytes: bytes.byteLength,
    materials: [...materials],
    bounds,
    anchors,
  }
}

export async function loadBookGeometry(signal: AbortSignal) {
  const response = await fetch('/models/almanac/almanac-book.glb', { signal })
  if (!response.ok)
    throw new Error(
      `The Almanac model could not load (HTTP ${response.status}).`,
    )
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw new Error('The Almanac model exceeds the 32 MiB study budget.')
  return parseBookGlb(bytes)
}
