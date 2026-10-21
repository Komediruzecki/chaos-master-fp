// Exported factors must select the intended detail, without texturing ink or gems.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { d } from 'typegpu'
import { parseBookGlb } from '../src/almanac/bookAsset'
import { bookSurfaceKind } from '../src/almanac/bookSurface'

await test('authored paper, leather and gilt select filtered grain; ink, gems and silver remain smooth', async () => {
  const expected: Record<string, number> = {
    'Paper | night black': 1,
    'Relief | night enamel': 1,
    'Leather | tobacco black': 2,
    'Page edges | gilt': 3,
    'Relief | burnished gold': 3,
    'Ink | bone highlight': 0,
    'Ink | bone engraving': 0,
    'Thread | rubric silk': 0,
    'Relief | verdigris glass': 0,
    'Relief | satin silver': 0,
  }
  const seen = new Set<string>()
  for (const name of ['almanac-book', 'glasswake-earned', 'tideweave-earned']) {
    const bytes = await readFile(
      new URL(`../public/models/almanac/${name}.glb`, import.meta.url),
    )
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    parseBookGlb(buffer)
    const view = new DataView(buffer)
    const document = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(buffer, 20, view.getUint32(12, true)),
      ),
    )
    for (const material of document.materials) {
      if (!(material.name in expected)) continue
      const pbr = material.pbrMetallicRoughness
      const base = pbr.baseColorFactor
      const actual = bookSurfaceKind(
        d.vec3f(base[0], base[1], base[2]),
        d.vec4f(pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1, 0, 1),
      )
      assert.equal(actual, expected[material.name], material.name)
      seen.add(material.name)
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(expected).sort())
})

await test('unrelated dark materials do not acquire book paper or leather grain', () => {
  for (const rough of [0.2, 0.58, 0.86]) {
    assert.equal(
      bookSurfaceKind(d.vec3f(0.02, 0.04, 0.09), d.vec4f(0, rough, 0, 1)),
      0,
    )
  }
})
