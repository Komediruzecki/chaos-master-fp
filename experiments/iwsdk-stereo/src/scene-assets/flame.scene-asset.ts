// A meter-scale cloud of real app IFS samples, rendered as instanced soft splats.
import { AdditiveBlending, Float32BufferAttribute, GLSL3, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicMaterial, RawShaderMaterial, Sphere, SphereGeometry, TorusGeometry, Vector3, } from '@iwsdk/core'
import { samplePoints } from '../../../typegpu-gl/src/variations'
import { fragmentShader, vertexShader } from '../flame-shader'

export const pointCount = 32768
const samples = samplePoints(pointCount)
const positions = new Float32Array(pointCount * 3)
const colors = new Float32Array(pointCount)
for (let i = 0; i < pointCount; i++) {
  positions.set(samples.subarray(i * 4, i * 4 + 3), i * 3)
  colors[i] = samples[i * 4 + 3]
}
const geometry = new InstancedBufferGeometry()
geometry.setAttribute(
  'position',
  new Float32BufferAttribute(
    [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0],
    3,
  ),
)
geometry.setAttribute(
  'flamePosition',
  new InstancedBufferAttribute(positions, 3),
)
geometry.setAttribute('flameColor', new InstancedBufferAttribute(colors, 1))
geometry.instanceCount = pointCount
// Account for generated coordinates and bounded breathing when frustum culling.
let radius = 0
for (let i = 0; i < positions.length; i += 3)
  radius = Math.max(
    radius,
    Math.hypot(positions[i], positions[i + 1], positions[i + 2]),
  )
geometry.boundingSphere = new Sphere(new Vector3(), radius + 0.08)
const material = new RawShaderMaterial({
  glslVersion: GLSL3,
  vertexShader: `precision highp float;\nprecision highp int;\n${vertexShader}`,
  fragmentShader: `precision highp float;\nprecision highp int;\n${fragmentShader}`,
  uniforms: { time: { value: 0 }, selected: { value: 0 } },
  transparent: true,
  blending: AdditiveBlending,
  depthTest: true,
  depthWrite: false,
})
export const flame = new Group()
flame.name = 'Flame'
const cloud = new Mesh(geometry, material)
cloud.name = 'FlameCloud'
const halo = new Mesh(
  new TorusGeometry(1.17, 0.002, 6, 128),
  new MeshBasicMaterial({
    color: 0x61bfa7,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  }),
)
halo.name = 'SelectionHalo'
halo.rotation.x = Math.PI * 0.37
// Dedicated cheap interaction volume; invisible but still ray-selectable.
const hit = new Mesh(
  new SphereGeometry(radius, 16, 12),
  new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
)
hit.name = 'FlameHitTarget'
flame.add(cloud, halo, hit)
