// Material selection is checked against the shipped GLB factors and the actual temple vertices.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { d } from 'typegpu'
import { parseBookGlb } from '../src/almanac/bookAsset'
import { sceneSurfaceKind } from '../src/observatory/sceneSurface'
import { createTempleConnections, createTempleParts, } from '../src/observatory/temple'

interface MaterialDocument {
  materials: {
    name: string
    pbrMetallicRoughness: {
      baseColorFactor: [number, number, number, number]
      metallicFactor?: number
      roughnessFactor?: number
    }
  }[]
}

await test('shipping architecture selects stone, lacquer and alloy without texturing enamel or silver', async () => {
  const expected: Record<string, number> = {
    'Basalt | blue': 1,
    'Brass | bright': 3,
    'Brass | muted': 3,
    'Enamel | tide': 0,
    'Slate | inset': 1,
    'Relic | patinated teal bronze': 3,
    'Bay | black basalt': 1,
    'Bay | blackened bronze': 3,
    'Bay | bone enamel': 0,
    'Bay | charcoal inset': 2,
    'Bay | satin silver': 0,
  }
  const seen = new Set<string>()
  for (const name of [
    'observation-bay',
    'bridge-segment',
    'far-landing',
    'celestial-seed',
  ]) {
    const bytes = await readFile(
      new URL(`../public/models/observatory/${name}.glb`, import.meta.url),
    )
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    const geometry = parseBookGlb(buffer)
    const document = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true)),
      ),
    ) as MaterialDocument
    assert.deepEqual(
      geometry.materials,
      document.materials.map((material) => material.name),
    )
    for (const material of document.materials) {
      assert.ok(
        material.name in expected,
        `${name}: review any new material before applying grain`,
      )
      const pbr = material.pbrMetallicRoughness
      const base = pbr.baseColorFactor
      assert.equal(
        sceneSurfaceKind(
          d.vec3f(base[0], base[1], base[2]),
          d.vec4f(pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1, 0, 1),
        ),
        expected[material.name],
        `${name}: ${material.name}`,
      )
      seen.add(material.name)
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(expected).sort())
})

await test('temple stone and gold retain their detail during the reveal while enamel and silver stay smooth', () => {
  // These are the five authored material identities, not thresholds duplicated from the classifier.
  const identities = [
    {
      name: 'threshold stone',
      base: [0.24, 0.3, 0.38],
      metal: 0.12,
      rough: 0.54,
      kind: 1,
    },
    {
      name: 'silver edge',
      base: [0.65, 0.68, 0.63],
      metal: 0.32,
      rough: 0.3,
      kind: 0,
    },
    {
      name: 'Glasswake gold',
      base: [0.92, 0.58, 0.19],
      metal: 0.65,
      rough: 0.28,
      kind: 3,
    },
    {
      name: 'Tideweave enamel',
      base: [0.13, 0.66, 0.59],
      metal: 0.32,
      rough: 0.3,
      kind: 0,
    },
    {
      name: 'pale joined seal',
      base: [0.72, 0.88, 0.81],
      metal: 0.38,
      rough: 0.3,
      kind: 0,
    },
  ]
  const seen = new Set<string>()
  for (const { id, geometry } of [
    ...createTempleParts(),
    ...createTempleConnections(),
  ]) {
    for (let offset = 0; offset < geometry.vertices.length; offset += 16) {
      const v = geometry.vertices
      const identity = identities.find(
        (material) =>
          material.base.every(
            (value, index) => Math.fround(value) === v[offset + 8 + index],
          ) &&
          Math.fround(material.metal) === v[offset + 12] &&
          Math.fround(material.rough) === v[offset + 13],
      )
      assert.ok(
        identity,
        `${id}: the actual geometry must have a reviewed material`,
      )
      for (const intensity of [0.4, 0.48, 1]) {
        assert.equal(
          sceneSurfaceKind(
            d.vec3f(
              v[offset + 8] * intensity,
              v[offset + 9] * intensity,
              v[offset + 10] * intensity,
            ),
            d.vec4f(
              v[offset + 12],
              v[offset + 13],
              v[offset + 14],
              v[offset + 15],
            ),
          ),
          identity.kind,
          `${id}: ${identity.name} at reveal intensity ${intensity}`,
        )
      }
      seen.add(identity.name)
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    identities.map((material) => material.name).sort(),
  )
})
