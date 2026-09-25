// Resolve app variation math to GLSL; Three owns buffers, uniforms and XR draws.
import { glOptions } from '@typegpu/gl'
import { d, std, tgpu } from 'typegpu'
import { sinusoidal3D } from '@/flame/variations/simple3D'
import { VariationInfo3D } from '@/flame/variations/simple3D/types'
import { variationInfo } from '../../typegpu-gl/src/variations'

const info = tgpu.const(VariationInfo3D, variationInfo)
const breathe = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((p, time) => {
  'use gpu'
  const wave = sinusoidal3D.fn(p.mul(3).add(d.vec3f(time * 0.2)), info.$)
  return p.add(wave.mul(0.018))
})

const palette = tgpu.fn(
  [d.f32, d.f32],
  d.vec3f,
)((color, selected) => {
  'use gpu'
  const cold = std.mix(
    d.vec3f(0.03, 0.36, 0.45),
    d.vec3f(0.65, 0.96, 0.42),
    color,
  )
  const warm = std.mix(d.vec3f(0.36, 0.1, 0.5), d.vec3f(1, 0.64, 0.2), color)
  return std.mix(cold, warm, selected)
})

export const vertexShader = tgpu.resolve({
  ...glOptions(),
  externals: { breathe },
  template: `
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform float time;
    in vec3 position;
    in vec3 flamePosition;
    in float flameColor;
    out vec2 uv;
    out float colorIndex;
    void main() {
      vec4 viewCenter = modelViewMatrix * vec4(breathe(flamePosition, time), 1.0);
      // World-sized splats. Each eye gets its own modelView/projection matrices.
      viewCenter.xy += position.xy * 0.006;
      gl_Position = projectionMatrix * viewCenter;
      uv = position.xy;
      colorIndex = flameColor;
    }
  `,
})

export const fragmentShader = tgpu.resolve({
  ...glOptions(),
  externals: { palette },
  template: `
    uniform float selected;
    in vec2 uv;
    in float colorIndex;
    out vec4 outColor;
    void main() {
      float radius = dot(uv, uv);
      if (radius > 1.0) discard;
      float alpha = exp(-3.5 * radius) * 0.65;
      outColor = vec4(palette(colorIndex, selected), alpha);
    }
  `,
})
