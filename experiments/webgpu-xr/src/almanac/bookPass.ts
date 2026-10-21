// Upload the exported book once and draw it into the existing scene render pass.
import { d } from 'typegpu'
import { bookDetailedSlot, bookDetailSlot, texturedBookSurface, } from './bookDetailShader'
import { bookFragment, bookLayout, bookVertex, bookVertexLayout, } from './bookShaders'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { BookGeometry } from './bookAsset'
import type { BookDetailResources } from './bookDetailResources'

export function createBookPass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
  geometry: BookGeometry,
  sampleCount = 1,
  detail?: BookDetailResources,
) {
  const resources: { destroy(): void }[] = []
  try {
    const vertices = root
      .createBuffer(
        bookVertexLayout.schemaForCount(geometry.vertices.length / 16),
      )
      .$usage('vertex')
    resources.push(vertices)
    const indices = root
      .createBuffer(d.arrayOf(d.u32, geometry.indices.length))
      .$usage('index')
    resources.push(indices)
    vertices.write(geometry.vertices.buffer)
    indices.write(geometry.indices.buffer)
    const shaderRoot = detail
      ? root
          .with(bookDetailSlot, texturedBookSurface)
          .with(bookDetailedSlot, true)
      : root
    const pipeline = shaderRoot
      .createRenderPipeline({
        attribs: { ...bookVertexLayout.attrib },
        vertex: bookVertex,
        fragment: bookFragment,
        targets: { format: 'rgba16float' },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        multisample: { count: sampleCount },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      })
      .with(root.createBindGroup(bookLayout, { camera }))
      .with(bookVertexLayout, vertices)
      .withIndexBuffer(indices)
    root.unwrap(pipeline)
    return {
      draw(pass: GPURenderPassEncoder) {
        const bound = detail ? pipeline.with(detail.group) : pipeline
        bound.with(pass).drawIndexed(geometry.indices.length)
      },
      dispose() {
        resources.forEach((resource) => {
          resource.destroy()
        })
        resources.length = 0
      },
    }
  } catch (error) {
    resources.forEach((resource) => {
      resource.destroy()
    })
    throw error
  }
}
