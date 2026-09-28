import { describe, expect, it } from 'vitest'
import { example1 } from '@/flame/examples/example1'
import { validateFlame } from '@/flame/schema/flameSchema'
import { deepClone } from '@/utils/clone'
import goldenV0911 from './__fixtures__/share-link-v0.9.11.json'
import { buildSharePayload, decodeSharePayload, encodeSharePayload, } from './jsonQueryParam'
import type { AudioMapping } from '@/flame/schema/audioWiring'

describe('jsonQueryParam share payload encoding/decoding', () => {
  it('round-trips a flame exactly, not just its transform count', async () => {
    // A count survives almost any corruption; the whole flame has to match.
    const decoded = await decodeSharePayload(await encodeSharePayload(example1))
    expect(decoded.flame).toEqual(validateFlame(deepClone(example1)))
  })

  it('still opens a share link created by v0.9.11', async () => {
    // Captured by encoding example1 on the v0.9.11 tag, with what that release
    // decoded it to. Links from before the refactor are posted all over the
    // place; if this fails, every one of them is broken.
    const decoded = await decodeSharePayload(goldenV0911.golden)
    expect(decoded.flame).toEqual(goldenV0911.decoded)
  })

  it('rejects completely corrupted or malformed base64 strings', async () => {
    await expect(
      decodeSharePayload('not-a-valid-payload-###'),
    ).rejects.toThrow()
  })

  it('rejects an empty or non-flame payload', async () => {
    await expect(decodeSharePayload('')).rejects.toThrow()
  })
})

describe('the audio wiring in a share link', () => {
  const wiring: AudioMapping = {
    preset: 'custom',
    mappings: [
      {
        audioFeature: 'bass',
        target: { kind: 'renderSetting', param: 'vibrancy' },
        sensitivity: 1,
        range: [0.5, 1.5],
        attackMs: 40,
        releaseMs: 300,
      },
    ],
  }

  it('travels with the flame', async () => {
    const decoded = await decodeSharePayload(
      await encodeSharePayload(example1, undefined, undefined, wiring),
    )
    expect(decoded.audio).toEqual(wiring)
    expect(decoded.flame).toEqual(validateFlame(deepClone(example1)))
  })

  it('is dropped on its own when it does not fit, and the flame still opens', async () => {
    const hostile = {
      ...wiring,
      mappings: [{ ...wiring.mappings[0], audioFeature: 'treble' }],
    } as unknown as AudioMapping
    const decoded = await decodeSharePayload(
      await encodeSharePayload(example1, undefined, undefined, hostile),
    )
    expect(decoded.audio).toBeUndefined()
    expect(decoded.flame).toEqual(validateFlame(deepClone(example1)))
  })

  it('is absent from a link made before links carried it', async () => {
    const decoded = await decodeSharePayload(goldenV0911.golden)
    expect(decoded.audio).toBeUndefined()
  })

  it('is left out of the payload when there is none to share', () => {
    expect(
      buildSharePayload(example1, undefined, undefined, {
        preset: 'custom',
        mappings: [],
      }),
    ).toEqual({ flame: example1 })
  })
})
