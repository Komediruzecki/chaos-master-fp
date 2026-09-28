// Pins what a JSON file dropped on the canvas opens as: a flame when it holds
// one (a bare descriptor, a share payload, a Recents record), a steps session
// otherwise, and a complaint naming the file when it is neither.
import { describe, expect, it, vi } from 'vitest'
import { examples } from '@/flame/examples'
import { validateFlame } from '@/flame/schema/flameSchema'
import { MAX_SESSION_JSON_CHARS, SESSION_FORMAT_VERSION, } from '@/recorder/schema'
import { deepClone } from './clone'
import { useLoadFlameFromFile } from './useLoadFlameFromFile'
import type { AudioMapping } from '@/flame/schema/audioWiring'
import type { RecordedSession } from '@/recorder/schema'

const { alertMock } = vi.hoisted(() => ({
  alertMock: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/components/Modal/useAlert', () => ({ useAlert: () => alertMock }))

const jsonFile = (value: unknown, name = 'dropped.json') =>
  new File([JSON.stringify(value)], name, { type: 'application/json' })

const audio: AudioMapping = {
  preset: 'custom',
  mappings: [
    {
      audioFeature: 'rms',
      target: {
        kind: 'transformAffine',
        transformIdx: 0,
        matrix: 'preAffine',
        param: 'c',
      },
      sensitivity: 2,
      range: [0.3, 2],
      attackMs: 1500,
      releaseMs: 1500,
    },
  ],
}

// Written with the defaults the timeline schema fills in, so what comes back
// is what went in.
const tracks = [
  {
    parameterPath: 'renderSettings.exposure',
    keyframes: [
      { frame: 0, value: 1, easing: 'linear', interp: 'linear' },
      { frame: 60, value: 2, easing: 'linear', interp: 'linear' },
    ],
  },
]

function session(): RecordedSession {
  return {
    version: SESSION_FORMAT_VERSION,
    app: { version: 'test', flameSchemaVersion: 'test' },
    createdAt: '2026-08-21T12:00:00.000Z',
    initial: deepClone(examples.example1),
    actions: [],
    unnamedWriteCount: 0,
  }
}

describe('a JSON file dropped on the canvas', () => {
  it('opens a bare flame descriptor as that flame', async () => {
    const result = await useLoadFlameFromFile()(jsonFile(examples.example1))
    expect(result?.flame).toEqual(validateFlame(deepClone(examples.example1)))
    expect(result?.session).toBeUndefined()
  })

  it('opens a share payload with its animation and audio wiring', async () => {
    const result = await useLoadFlameFromFile()(
      jsonFile({ flame: examples.example1, animation: { tracks }, audio }),
    )
    expect(result?.flame).toEqual(validateFlame(deepClone(examples.example1)))
    expect(result?.animation?.tracks).toEqual(tracks)
    expect(result?.audio).toEqual(audio)
  })

  it('still opens a steps session as a session', async () => {
    const result = await useLoadFlameFromFile()(
      jsonFile(session(), 'take.steps.json'),
    )
    expect(result?.flame).toBeUndefined()
    expect(result?.session?.createdAt).toBe(session().createdAt)
  })

  it('names the file when it holds neither', async () => {
    alertMock.mockClear()
    const result = await useLoadFlameFromFile()(jsonFile({ hello: 'world' }))
    expect(result).toBeUndefined()
    expect(alertMock).toHaveBeenCalledWith(
      "No valid flame or steps found in 'dropped.json'.",
    )
  })

  // A dropped JSON may be a flame as much as a session, so the refusal names
  // no one of them.
  it('says a JSON file is too large without calling it a steps session', async () => {
    alertMock.mockClear()
    const big = new File(['x'.repeat(MAX_SESSION_JSON_CHARS + 1)], 'big.json', {
      type: 'application/json',
    })
    expect(await useLoadFlameFromFile()(big)).toBeUndefined()
    expect(alertMock).toHaveBeenCalledWith(
      "'big.json' is too large to load: a JSON file may be up to 8 MB.",
    )
  })

  // A Recents record keeps its timeline at the top level, where only the
  // Library reads it; a dropped record opens as its flame and wiring.
  it('opens a Recents record as its flame and wiring, without its timeline', async () => {
    const result = await useLoadFlameFromFile()(
      jsonFile({
        id: 'r1',
        name: 'Kept',
        savedAt: 1,
        flame: examples.example1,
        tracks,
        audio,
      }),
    )
    expect(result?.flame).toEqual(validateFlame(deepClone(examples.example1)))
    expect(result?.audio).toEqual(audio)
    expect(result?.animation).toBeUndefined()
  })
})
