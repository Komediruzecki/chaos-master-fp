/** One or two deforming candy pieces share the board HDR optics with cached waiting instances. */
import { common } from 'typegpu'
import { gummyDisplayFragment } from '../GummyBear/gummyShaders'
import { marchingGummyArtSlot, marchingGummyComposite, marchingGummyFillSlot, marchingGummyMaterialSlot, } from '../GummyBear/marchingGummyRenderShaders'
import { gummyBoardBackgroundFragment, gummyBoardExitFragment, gummyBoardFill, gummyBoardFrontFragment, gummyBoardLightFragment, gummyBoardLightVertex, gummyBoardOptics, gummyBoardShadowFragment, gummyBoardShadowVertex, gummyBoardVertex, } from './gummyBoardShaders'
import type { TgpuRoot } from 'typegpu'
import type { GummyBoardMeshQuality } from './gummyBoardMeshPreparation'
import type { GummyBoardRenderResources } from './gummyBoardRenderResources'

export function createGummyBoardRenderPipelines(
  root: TgpuRoot,
  format: GPUTextureFormat,
  quality: GummyBoardMeshQuality,
  resources: GummyBoardRenderResources,
) {
  const { cameraGroup, floorGroup, stageGroup, materialGroup, depth, blend } =
    resources
  const front = root
    .createRenderPipeline({
      vertex: gummyBoardVertex,
      fragment: gummyBoardFrontFragment,
      targets: {
        front: { format: 'rgba16float' },
        rest: { format: 'rgba16float' },
      },
      depthStencil: depth,
    })
    .with(cameraGroup)

  const exit = root
    .createRenderPipeline({
      vertex: gummyBoardVertex,
      fragment: gummyBoardExitFragment,
      targets: { format: 'rgba16float' },
      depthStencil: depth,
    })
    .with(cameraGroup)

  const caustics = root
    .createRenderPipeline({
      vertex: gummyBoardLightVertex,
      fragment: gummyBoardLightFragment,
      targets: { format: 'rgba16float', blend },
      primitive: { cullMode: 'none' },
    })
    .with(cameraGroup)

  const shadow = root
    .createRenderPipeline({
      vertex: gummyBoardShadowVertex,
      fragment: gummyBoardShadowFragment,
      targets: { format: 'rgba16float', blend },
      primitive: { cullMode: 'none' },
    })
    .with(cameraGroup)

  const background = root
    .createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: gummyBoardBackgroundFragment,
      targets: { colour: { format: 'rgba16float' } },
      depthStencil: { ...depth, depthCompare: 'always' },
    })
    .with(cameraGroup)
    .with(floorGroup)
    .with(stageGroup)
  const composite = root
    .with(marchingGummyMaterialSlot, gummyBoardOptics)
    .with(marchingGummyArtSlot, quality.artStyle === 'sculpted')
    .with(marchingGummyFillSlot, gummyBoardFill)
    .createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: marchingGummyComposite,
      targets: { format: 'rgba16float' },
    })
    .with(cameraGroup)
    .with(materialGroup)
    .with(stageGroup)
  const display = root
    .createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: gummyDisplayFragment,
      targets: { format },
    })
    .with(cameraGroup)
  for (const pipeline of [
    front,
    exit,
    caustics,
    shadow,
    background,
    composite,
    display,
  ])
    root.unwrap(pipeline)
  return { front, exit, caustics, shadow, background, composite, display }
}
