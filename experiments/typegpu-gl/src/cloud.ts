// Display CPU-sampled IFS points with the GL fallback's texture/triangle subset.
import { initWithGL } from '@typegpu/gl'
import { d, std, tgpu } from 'typegpu'
import { samplePoints } from './variations'

export function createCloud(canvas: HTMLCanvasElement) {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
  if (!gl) throw new Error('WebGL 2 is unavailable')
  const root = initWithGL({ gl })
  const context = root.configureContext({ canvas, alphaMode: 'opaque' })
  const pointData = samplePoints()
  const texture = root
    .createTexture({ size: [128, 128], format: 'rgba32float' })
    .$usage('sampled')
  texture.write(pointData)
  const points = texture.createView()
  const camera = root.createUniform(d.vec4f, d.vec4f(0, 1, 1, 0))
  const corners = tgpu.const(d.arrayOf(d.vec2f, 6), [
    d.vec2f(-1, -1),
    d.vec2f(1, -1),
    d.vec2f(1, 1),
    d.vec2f(-1, -1),
    d.vec2f(1, 1),
    d.vec2f(-1, 1),
  ])
  const pipeline = root.createRenderPipeline({
    vertex: ({ $vertexIndex: index }) => {
      'use gpu'
      const id = d.u32(index / 6)
      const point = std.textureLoad(
        points.$,
        d.vec2i(d.i32(id % 128), d.i32(id / 128)),
        0,
      )
      const c = std.cos(camera.$.x)
      const s = std.sin(camera.$.x)
      const rotated = d.vec3f(
        point.x * c + point.z * s,
        point.y,
        point.z * c - point.x * s,
      )
      const depth = 3.5 - rotated.z
      const center = d
        .vec2f(rotated.x / camera.$.y, rotated.y)
        .mul((2.3 * camera.$.z) / depth)
      const corner = corners.$[index % 6]
      return {
        $position: d.vec4f(center.add(corner.mul(0.003)), 0, 1),
        uv: d.vec2f(corner),
        shade: d.vec2f(point.w, std.clamp((rotated.z + 1.5) / 3, 0.1, 1)),
      }
    },
    fragment: ({ uv, shade }) => {
      'use gpu'
      const falloff = std.max(0, 1 - std.dot(uv, uv))
      const color = std.mix(
        d.vec3f(0.12, 0.55, 0.68),
        d.vec3f(0.83, 0.99, 0.55),
        shade.x,
      )
      return d.vec4f(color.mul(falloff * (0.3 + shade.y * 0.7)), 1)
    },
  })

  function draw(angle: number, zoom = 1) {
    camera.write(d.vec4f(angle, canvas.width / canvas.height, zoom, 0))
    pipeline
      .withColorAttachment({
        view: context,
        clearValue: [0.015, 0.025, 0.035, 1],
      })
      .draw((pointData.length / 4) * 6)
  }
  return {
    draw,
    pointCount: pointData.length / 4,
    dispose: () => {
      root.destroy()
      // The fallback does not track programs/VAOs in destroy(); release our context.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
