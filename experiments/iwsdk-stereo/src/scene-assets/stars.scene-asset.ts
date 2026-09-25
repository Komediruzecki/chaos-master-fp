// Seeded distant stars supply depth cues without moving the viewer or a sky image.
import { BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, } from '@iwsdk/core'

const positions = new Float32Array(1500 * 3)
let seed = 64219

function random() {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) / 4294967296
}
for (let i = 0; i < positions.length; i += 3) {
  const azimuth = random() * Math.PI * 2
  const y = random() * 2 - 1
  const distance = 18 + random() * 60
  const ring = Math.sqrt(1 - y * y)
  positions.set(
    [
      Math.cos(azimuth) * ring * distance,
      y * distance,
      Math.sin(azimuth) * ring * distance,
    ],
    i,
  )
}
const geometry = new BufferGeometry()
geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
export const stars = new Points(
  geometry,
  new PointsMaterial({
    color: 0x719eae,
    size: 0.04,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  }),
)
stars.name = 'Stars'
