/** One sampled texture replaces analytic contact for a selected mould without adding storage buffers. */
import { d, std, tgpu } from 'typegpu'
import { bakeGummyChessColliderField } from './gummyChessColliderField'
import type { TgpuBuffer, TgpuRoot } from 'typegpu'
import type { GummyChessArtStyle, GummyChessMould } from './gummyChessMoulds'

const GummyChessColliderParameters = d.struct({
  origin: d.vec4f,
  maximum: d.vec4f,
  /** Sine and cosine of the fixed mould orientation. */
  rotation: d.vec4f,
})
export const gummyChessColliderLayout = tgpu.bindGroupLayout({
  params: { uniform: GummyChessColliderParameters },
  field: { texture: d.texture3d(d.f32), sampleType: 'unfilterable-float' },
})

export const gummyChessColliderLocalPoint = tgpu.fn(
  [d.vec3f, d.vec2f],
  d.vec3f,
)((point, rotation) => {
  'use gpu'
  return d.vec3f(
    point.x * rotation.y - point.z * rotation.x,
    point.y,
    point.z * rotation.y + point.x * rotation.x,
  )
})
export const gummyChessColliderWorldNormal = tgpu.fn(
  [d.vec3f, d.vec2f],
  d.vec3f,
)((normal, rotation) => {
  'use gpu'
  return d.vec3f(
    normal.x * rotation.y + normal.z * rotation.x,
    normal.y,
    normal.z * rotation.y - normal.x * rotation.x,
  )
})

export const gummyChessColliderMayContact = (point: d.v3f, radius: number) => {
  'use gpu'
  const params = gummyChessColliderLayout.$.params
  const local = gummyChessColliderLocalPoint(point, params.rotation.xy)
  return (
    local.x >= params.origin.x - radius &&
    local.y >= params.origin.y - radius &&
    local.z >= params.origin.z - radius &&
    local.x <= params.maximum.x + radius &&
    local.y <= params.maximum.y + radius &&
    local.z <= params.maximum.z + radius
  )
}

/** Eight unfiltered loads work on baseline iOS WebGPU; no float32-filterable feature is required. */
export const gummyChessColliderContact = (point: d.v3f) => {
  'use gpu'
  const params = gummyChessColliderLayout.$.params
  const local = gummyChessColliderLocalPoint(point, params.rotation.xy)
  const dimensions = d.vec3i(
    std.textureDimensions(gummyChessColliderLayout.$.field),
  )
  const coordinate = std.clamp(
    std.mul(std.sub(local, params.origin.xyz), params.origin.w),
    d.vec3f(0),
    std.sub(d.vec3f(dimensions), d.vec3f(1)),
  )
  const base = std.min(
    d.vec3i(std.floor(coordinate)),
    std.sub(dimensions, d.vec3i(2)),
  )
  const fraction = std.sub(coordinate, d.vec3f(base))
  let contact = d.vec4f(0)
  for (let z = d.i32(0); z < 2; z++)
    for (let y = d.i32(0); y < 2; y++)
      for (let x = d.i32(0); x < 2; x++) {
        const offset = d.vec3i(x, y, z)
        const weights = std.mix(
          std.sub(d.vec3f(1), fraction),
          fraction,
          d.vec3f(offset),
        )
        contact = std.add(
          contact,
          std.mul(
            std.textureLoad(
              gummyChessColliderLayout.$.field,
              std.add(base, offset),
              0,
            ),
            weights.x * weights.y * weights.z,
          ),
        )
      }
  const length = std.length(contact.xyz)
  let normal = d.vec3f(0, -1, 0)
  if (length > 1e-6) normal = std.div(contact.xyz, length)
  return d.vec4f(
    gummyChessColliderWorldNormal(normal, params.rotation.xy),
    contact.w,
  )
}

export function createGummyChessCollider(
  root: TgpuRoot,
  device: GPUDevice,
  mould: GummyChessMould,
  rotationY = 0,
  artStyle: GummyChessArtStyle = 'classic',
) {
  if (!Number.isFinite(rotationY))
    throw new RangeError('Collider orientation must be finite')
  const field = bakeGummyChessColliderField(mould, artStyle)
  const texture = device.createTexture({
    label: `Gummy ${mould} contact field`,
    dimension: '3d',
    size: field.size,
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  let params: TgpuBuffer<typeof GummyChessColliderParameters> | undefined
  try {
    device.queue.writeTexture(
      { texture },
      field.values,
      { bytesPerRow: field.size[0] * 16, rowsPerImage: field.size[1] },
      field.size,
    )
    const buffer = root
      .createBuffer(GummyChessColliderParameters, {
        origin: d.vec4f(...field.origin, 1 / field.step),
        maximum: d.vec4f(...field.maximum, 0),
        rotation: d.vec4f(Math.sin(rotationY), Math.cos(rotationY), 0, 0),
      })
      .$usage('uniform')
    params = buffer
    const group = root.createBindGroup(gummyChessColliderLayout, {
      params: buffer,
      field: texture.createView(),
    })
    let disposed = false
    return {
      group,
      destroy() {
        if (disposed) return
        disposed = true
        buffer.destroy()
        texture.destroy()
      },
    }
  } catch (error) {
    params?.destroy()
    texture.destroy()
    throw error
  }
}
