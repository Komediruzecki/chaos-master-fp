// Palette values are authored into the shipping meshes, not inferred by a loader override.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

type Factors = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]
const palette: Record<string, Factors> = {
  'Paper | night black': [0.03, 0.029, 0.032, 0, 0.86, 0.35, 0, 0, 0],
  'Ink | bone highlight': [0.6, 0.56, 0.48, 0, 0.62, 0.5, 0, 0, 0],
  'Ink | bone engraving': [0.6, 0.56, 0.48, 0, 0.62, 0.5, 0, 0, 0],
  'Page edges | gilt': [0.95, 0.74, 0.4, 1, 0.34, 1, 0, 0, 0],
  'Leather | tobacco black': [0.03, 0.022, 0.018, 0, 0.58, 0.45, 0, 0, 0],
  'Thread | rubric silk': [0.4, 0.045, 0.025, 0, 0.4, 0.7, 0, 0, 0],
  'Page seams | bronze': [0.055, 0.032, 0.018, 0.2, 0.78, 1, 0, 0, 0],
  'Relief | night enamel': [0.03, 0.029, 0.032, 0, 0.86, 0.35, 0, 0, 0],
  'Relief | burnished gold': [1, 0.77, 0.34, 1, 0.24, 1, 0, 0, 0],
  'Relief | verdigris glass': [0.02, 0.2, 0.15, 0, 0.08, 1, 0.004, 0.03, 0.024],
  'Relief | satin silver': [0.9, 0.89, 0.86, 1, 0.36, 1, 0, 0, 0],
}

await test('fresh book and earned relief GLBs carry the complete authored Night Almanac palette', async () => {
  const seen = new Set<string>()
  for (const name of ['almanac-book', 'glasswake-earned', 'tideweave-earned']) {
    const bytes = await readFile(
      new URL(`../public/models/almanac/${name}.glb`, import.meta.url),
    )
    const document = JSON.parse(
      bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
    )
    for (const material of document.materials) {
      const expected = palette[material.name]
      assert.ok(expected, `Unreviewed material ${material.name}`)
      const pbr = material.pbrMetallicRoughness
      const actual = [
        ...pbr.baseColorFactor.slice(0, 3),
        pbr.metallicFactor ?? 1,
        pbr.roughnessFactor ?? 1,
        material.extensions?.KHR_materials_specular?.specularFactor ?? 1,
        ...(material.emissiveFactor ?? [0, 0, 0]),
      ]
      actual.forEach((factor, index) => {
        assert.ok(
          Math.abs(factor - expected[index]) < 1e-6,
          `${material.name} factor ${index}: ${factor} != ${expected[index]}`,
        )
      })
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE')
      assert.equal(pbr.baseColorFactor[3], 1)
      seen.add(material.name)
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(palette).sort())
})
