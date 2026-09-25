// Numerical GLSL checks and capability probes for the pinned published package.
import { dualGlOptions, initWithGL } from '@typegpu/gl'
import { d, tgpu } from 'typegpu'
import { VariationInfo3D } from '@/flame/variations/simple3D/types'
import { fixturePoints, variationInfo, variations } from './variations'

export interface Probe {
  name: string
  passed: boolean
  detail: string
}
const header = '#version 300 es\nprecision highp float;\nprecision highp int;\n'

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, header + source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`${error}\n${source}`)
  }
  return shader
}

export function runProbes() {
  const canvas = new OffscreenCanvas(fixturePoints.length, 1)
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL 2 is unavailable')
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debug
    ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER)
  const probes: Probe[] = []
  const shaders: Record<string, { vertex: string; fragment: string }> = {}
  const floatColor = gl.getExtension('EXT_color_buffer_float')
  const root = initWithGL({ gl })
  const expectedUnsupported: [string, () => unknown, RegExp?][] = [
    [
      'compute pipeline',
      () =>
        root.createComputePipeline({
          compute: tgpu.computeFn({ workgroupSize: [1] })(() => {
            'use gpu'
          }),
        }),
    ],
    ['storage buffer', () => root.createMutable(d.arrayOf(d.vec4f, 4))],
    ['vertex buffer', () => root.createBuffer(d.arrayOf(d.vec3f, 4))],
    ['readonly buffer', () => root.createReadonly(d.arrayOf(d.vec4f, 4))],
    ['GPU device access', () => root.device],
    [
      'HTML canvas context',
      () => {
        const context = document.createElement('canvas').getContext('webgl2')!
        try {
          return initWithGL({ gl: context })
        } finally {
          context.getExtension('WEBGL_lose_context')?.loseContext()
        }
      },
      /must be created with an OffscreenCanvas/,
    ],
  ]
  for (const [
    capability,
    operation,
    expected = /WebGLFallbackUnsupportedError/,
  ] of expectedUnsupported) {
    const name = `Rejects ${capability}`
    try {
      operation()
      probes.push({
        name,
        passed: false,
        detail: 'Unexpectedly accepted; re-evaluate capability matrix',
      })
    } catch (error) {
      probes.push({
        name,
        passed: expected.test(String(error)),
        detail: `Rejection: ${String(error)}`,
      })
    }
  }
  if (!floatColor)
    probes.push({
      name: 'float readback',
      passed: false,
      detail: 'EXT_color_buffer_float unavailable: numeric parity not verified',
    })
  else {
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      fixturePoints.length,
      1,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    )
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Float framebuffer incomplete')
    const positions = tgpu.const(d.arrayOf(d.vec2f, 3), [
      d.vec2f(-1, -1),
      d.vec2f(3, -1),
      d.vec2f(-1, 3),
    ])
    const points = tgpu.const(
      d.arrayOf(d.vec3f, fixturePoints.length),
      fixturePoints,
    )
    const info = tgpu.const(VariationInfo3D, variationInfo)
    const vertex = tgpu.vertexFn({
      in: { index: d.builtin.vertexIndex },
      out: { position: d.builtin.position },
    })(({ index }) => {
      'use gpu'
      return { position: d.vec4f(positions.$[index], 0, 1) }
    })
    for (const [name, variation] of Object.entries(variations)) {
      const fn = variation.fn
      try {
        const fragment = tgpu.fragmentFn({
          in: { position: d.builtin.position },
          out: d.vec4f,
        })(({ position }) => {
          'use gpu'
          return d.vec4f(fn(points.$[d.u32(position.x)], info.$), 1)
        })
        const options = dualGlOptions()
        const vertexSource = tgpu.resolve([vertex, fragment], options.vertex)
        const fragmentSource = tgpu.resolve(
          [vertex, fragment],
          options.fragment,
        )
        shaders[name] = {
          vertex: header + vertexSource,
          fragment: header + fragmentSource,
        }
        const vs = compile(gl, gl.VERTEX_SHADER, vertexSource)
        const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
        const program = gl.createProgram()
        gl.attachShader(program, vs)
        gl.attachShader(program, fs)
        gl.linkProgram(program)
        gl.deleteShader(vs)
        gl.deleteShader(fs)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program) ?? 'Link failed')
        gl.useProgram(program)
        gl.viewport(0, 0, fixturePoints.length, 1)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        const actual = new Float32Array(fixturePoints.length * 4)
        gl.readPixels(0, 0, fixturePoints.length, 1, gl.RGBA, gl.FLOAT, actual)
        const errors = fixturePoints.flatMap((point, i) => {
          const expected = fn(point, variationInfo)
          return [expected.x, expected.y, expected.z].map(
            (value, j) =>
              Math.abs(actual[i * 4 + j] - value) /
              Math.max(1, Math.abs(value)),
          )
        })
        const maxError = Math.max(...errors)
        const glError = gl.getError()
        probes.push({
          name,
          passed:
            Number.isFinite(maxError) &&
            maxError < 0.0001 &&
            glError === gl.NO_ERROR,
          detail: `Five 3D inputs; max normalized error ${maxError.toExponential(3)}; GL error ${glError}`,
        })
        gl.deleteProgram(program)
      } catch (error) {
        probes.push({ name, passed: false, detail: String(error) })
      }
    }
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
  }
  root.destroy()
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return {
    packages: { typegpu: '0.12.5', gl: '0.12.4', compiler: '0.12.3' },
    renderer,
    userAgent: window.navigator.userAgent,
    probes,
    shaders,
    headsetTested: false,
  }
}
