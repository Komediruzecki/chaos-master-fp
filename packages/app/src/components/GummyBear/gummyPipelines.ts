/** Root-scoped unbound GPU pipelines reused when fracture changes only geometry buffers. */
import { common } from 'typegpu'
import { gummyRoundingCompute } from './gummyRoundedSurfaceShaders'
import { gummyBackgroundFragment, gummyCausticFragment, gummyCausticVertex, gummyDisplayFragment, gummyExitFragment, gummyFragment, gummyFrontTagFragment, gummyNormalsCompute, gummyRuntimeExitFragment, gummyShadowFragment, gummyShadowVertex, gummyVertex, } from './gummyShaders'
import type { TgpuRoot } from 'typegpu'

const cache = new WeakMap<
  TgpuRoot,
  Map<string, ReturnType<typeof createPipelines>>
>()

/** Bound variants share TypeGPU's compiled core but retain each renderer's own buffers. */
export function getGummyPipelines(
  root: TgpuRoot,
  format: GPUTextureFormat,
  runtimeFracture: boolean,
) {
  let entries = cache.get(root)
  if (!entries) {
    entries = new Map()
    cache.set(root, entries)
  }
  const key = `${format}:${runtimeFracture}`
  const previous = entries.get(key)
  if (previous) return previous
  const pipelines = createPipelines(root, format, runtimeFracture)
  entries.set(key, pipelines)
  return pipelines
}

function createPipelines(
  root: TgpuRoot,
  format: GPUTextureFormat,
  runtimeFracture: boolean,
) {
  const compute = root.createComputePipeline({ compute: gummyNormalsCompute })

  const roundCorners = root.createComputePipeline({
    compute: gummyRoundingCompute,
  })

  const depth: GPUDepthStencilState = {
    format: 'depth24plus',
    depthWriteEnabled: true,
    depthCompare: 'less-equal',
  }
  const front = root.createRenderPipeline({
    vertex: gummyVertex,
    fragment: gummyFragment,
    targets: { format: 'rgba16float' },
    primitive: { cullMode: 'back' },
    depthStencil: depth,
    multisample: { count: 4 },
  })

  const exits = root.createRenderPipeline({
    vertex: gummyVertex,
    fragment: runtimeFracture ? gummyRuntimeExitFragment : gummyExitFragment,
    targets: {
      world: { format: 'rgba16float' },
      rest: { format: 'rgba16float' },
    },
    primitive: { cullMode: 'front' },
    depthStencil: depth,
  })

  const frontTags = root.createRenderPipeline({
    vertex: gummyVertex,
    fragment: gummyFrontTagFragment,
    targets: { format: 'rg16float' },
    primitive: { cullMode: 'back' },
    depthStencil: depth,
  })

  const additive: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  }
  const shadow = root.createRenderPipeline({
    vertex: gummyShadowVertex,
    fragment: gummyShadowFragment,
    targets: { format: 'rgba16float', blend: additive },
    primitive: { cullMode: 'none' },
  })

  const caustic = root.createRenderPipeline({
    vertex: gummyCausticVertex,
    fragment: gummyCausticFragment,
    targets: { format: 'rgba16float', blend: additive },
    primitive: { cullMode: 'none' },
  })

  const background = root.createRenderPipeline({
    vertex: common.fullScreenTriangle,
    fragment: gummyBackgroundFragment,
    targets: { colour: { format: 'rgba16float' } },
    depthStencil: { ...depth, depthCompare: 'always' },
    multisample: { count: 4 },
  })

  const display = root.createRenderPipeline({
    vertex: common.fullScreenTriangle,
    fragment: gummyDisplayFragment,
    targets: { format },
  })

  root.unwrap(compute)
  root.unwrap(roundCorners)
  root.unwrap(background)
  root.unwrap(exits)
  if (runtimeFracture) root.unwrap(frontTags)
  for (const pipeline of [front, shadow, caustic, display])
    root.unwrap(pipeline)
  return {
    compute,
    roundCorners,
    front,
    exits,
    frontTags,
    shadow,
    caustic,
    background,
    display,
  }
}
