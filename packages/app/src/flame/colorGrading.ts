import { oklabToRgb } from '@typegpu/color'
import { onCleanup } from 'solid-js'
import { tgpu } from 'typegpu'
import { arrayOf, builtin, f32, i32, struct, vec2f, vec2i, vec3f, vec4f, } from 'typegpu/data'
import { abs, add, clamp, div, log, max, mix, mul, pow, saturate, smoothstep, sub, } from 'typegpu/std'
import { Bucket, BUCKET_FIXED_POINT_MULTIPLIER_INV } from './types'
import type { LayoutEntryToInput, TgpuRoot } from 'typegpu'
import type { Palette } from './colorMap'
import type { DrawModeFn } from './drawMode'

export const ColorGradingUniforms = struct({
  averagePointCountPerBucketInv: f32,
  exposure: f32,
  backgroundColor: vec4f,
  /** Adds a slight fade towards the edge of the viewport */
  edgeFadeColor: vec4f,
  /** Vibrancy: 0 = none, 1 = full saturation boost in dense regions */
  vibrancy: f32,
  /** Number of palette entries */
  paletteEntryCount: i32,
})

/** Palette entry: R=a, G=b, B=unused, A=position */
export const PaletteEntry = struct({
  a: f32,
  b: f32,
  position: f32,
})

const bindGroupLayout = tgpu.bindGroupLayout({
  uniforms: {
    uniform: ColorGradingUniforms,
  },
  textureSize: {
    uniform: vec2i,
  },
  accumulationBuffer: {
    storage: arrayOf(Bucket),
    access: 'readonly',
  },
  paletteBuffer: {
    storage: arrayOf(PaletteEntry),
    access: 'readonly',
  },
})

export function createColorGradingPipeline(
  root: TgpuRoot,
  uniforms: LayoutEntryToInput<(typeof bindGroupLayout)['entries']['uniforms']>,
  textureSize: readonly [number, number],
  accumulationBuffer: LayoutEntryToInput<
    (typeof bindGroupLayout)['entries']['accumulationBuffer']
  >,
  canvasFormat: GPUTextureFormat,
  drawMode: DrawModeFn,
  palette: Palette | undefined,
) {
  const textureSizeBuffer = root
    .createBuffer(vec2i, vec2i(...textureSize))
    .$usage('uniform')

  onCleanup(() => {
    textureSizeBuffer.destroy()
  })

  const entryCount = palette ? palette.entries.length : 1

  // Create palette buffer using tgpu (avoids texture binding origin "handle" issues)
  const paletteBuffer = root
    .createBuffer(arrayOf(PaletteEntry, entryCount))
    .$usage('storage')

  if (palette) {
    const sorted = [...palette.entries].sort((a, b) => a.position - b.position)
    const entries = sorted.map((entry) => ({
      a: entry.a,
      b: entry.b,
      position: entry.position,
    }))
    paletteBuffer.write(entries)
  }

  onCleanup(() => {
    paletteBuffer.destroy()
  })

  const bindGroup = root.createBindGroup(bindGroupLayout, {
    uniforms,
    accumulationBuffer,
    textureSize: textureSizeBuffer,
    paletteBuffer,
  })

  const VertexOutput = {
    pos: builtin.position,
    uv: vec2f,
  }

  const vertex = tgpu.vertexFn({
    in: { vertexIndex: builtin.vertexIndex },
    out: VertexOutput,
  })(({ vertexIndex }) => {
    const pos = [vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)]
    return {
      pos: vec4f(pos[vertexIndex]!, 0.0, 1.0),
      uv: pos[vertexIndex]!,
    }
  })

  const fragment = tgpu.fragmentFn({
    in: VertexOutput,
    out: vec4f,
  })(({ pos, uv }) => {
    'use gpu'
    const uniforms = bindGroupLayout.$.uniforms
    const textureSize = bindGroupLayout.$.textureSize
    const accumulationBuffer = bindGroupLayout.$.accumulationBuffer

    const edgeFade =
      uniforms.edgeFadeColor.a * smoothstep(0.98, 1, max(abs(uv.x), abs(uv.y)))
    const backgroundColor = mix(
      uniforms.backgroundColor,
      uniforms.edgeFadeColor,
      edgeFade,
    )
    const pos2i = vec2i(pos.xy)
    const texelIndex = pos2i.y * textureSize.x + pos2i.x
    const tex = accumulationBuffer[texelIndex]!
    const count = f32(tex.count) * BUCKET_FIXED_POINT_MULTIPLIER_INV
    const texColorAb = div(
      mul(
        vec2f(f32(tex.color.a), f32(tex.color.b)),
        BUCKET_FIXED_POINT_MULTIPLIER_INV,
      ),
      max(count, f32(1)),
    )

    // density: normalized count where PREFILTER_WHITE=255 marks a "full" texel.
    const density = div(
      mul(count, uniforms.averagePointCountPerBucketInv),
      f32(255),
    )

    let finalAb = vec2f(texColorAb)
    if (uniforms.paletteEntryCount > i32(0) && uniforms.vibrancy > f32(0)) {
      // Access palette via storage buffer (no texture binding = no origin "handle" issues)
      const paletteBuffer = bindGroupLayout.$.paletteBuffer

      // Log-density index for palette lookup.
      const logDensity = clamp(log(add(count, f32(1))), f32(0), f32(10))
      const paletteScale = f32(0.1)
      const logDensityNorm = clamp(
        mul(logDensity, paletteScale),
        f32(0),
        f32(1),
      )

      // Nearest-neighbor lookup: map logDensityNorm to palette entry index.
      const idx = i32(mul(f32(uniforms.paletteEntryCount), logDensityNorm))
      const clampedIdx = clamp(
        idx,
        i32(0),
        sub(uniforms.paletteEntryCount, i32(1)),
      )
      const entry = paletteBuffer[clampedIdx]!
      const paletteAb = vec2f(entry.a, entry.b)

      // Calculate alpha for vibrancy blend factor
      const gamma = f32(0.5)
      const linrange = f32(1.0)
      const frac = div(density, linrange)
      const funcval = pow(linrange, gamma)
      const baseAlpha = add(
        mul(mul(sub(f32(1), frac), density), div(funcval, linrange)),
        mul(frac, pow(density, gamma)),
      )

      // Interpolate between texel-averaged color and palette-sampled color
      const paletteBlend = clamp(
        mul(uniforms.vibrancy, saturate(baseAlpha)),
        f32(0),
        f32(1),
      )
      finalAb = mix(texColorAb, paletteAb, paletteBlend)
    }

    // Brightness from log-count
    const adjustedCount = mul(
      mul(count, uniforms.averagePointCountPerBucketInv),
      f32(0.1),
    )
    const value = clamp(
      uniforms.exposure * pow(log(adjustedCount + 1), 0.4545),
      f32(0),
      f32(2),
    )

    const rgb = saturate(oklabToRgb(vec3f(drawMode(value), finalAb)))
    const alpha = saturate(value) * (1 - edgeFade)
    const rgba = vec4f(rgb, alpha)
    return mix(backgroundColor, rgba, alpha)
  })

  const renderPipeline = root
    .createRenderPipeline({
      vertex,
      fragment,
      targets: { format: canvasFormat },
    })
    .with(bindGroup)

  return {
    run: (pass: GPURenderPassEncoder) => {
      renderPipeline.with(pass).draw(3)
    },
  }
}
