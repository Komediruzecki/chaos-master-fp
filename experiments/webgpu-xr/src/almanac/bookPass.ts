// Upload the exported book once and draw it into the existing scene render pass.
import { d } from 'typegpu'
import { bookFragment, bookLayout, bookVertex, bookVertexLayout, } from './bookShaders'
import type { TgpuBuffer, TgpuRoot, UniformFlag } from 'typegpu'
import type { View } from '../bench/shaders'
import type { BookGeometry } from './bookAsset'

export function createBookPass(
  root: TgpuRoot,
  camera: TgpuBuffer<typeof View> & UniformFlag,
  geometry: BookGeometry,
  sampleCount = 1,
) {
  const vertices = root
    .createBuffer(
      bookVertexLayout.schemaForCount(geometry.vertices.length / 16),
    )
    .$usage('vertex')
  const indices = root
    .createBuffer(d.arrayOf(d.u32, geometry.indices.length))
    .$usage('index')
  vertices.write(geometry.vertices.buffer)
  indices.write(geometry.indices.buffer)
  const pipeline = root
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
  try {
    root.unwrap(pipeline)
  } catch (error) {
    vertices.destroy()
    indices.destroy()
    throw error
  }
  return {
    draw(pass: GPURenderPassEncoder) {
      pipeline.with(pass).drawIndexed(geometry.indices.length)
    },
    dispose() {
      vertices.destroy()
      indices.destroy()
    },
  }
}
