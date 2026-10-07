// Regressions for capture directories, codec substitution, incomplete movies, and surface overflow.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { reserveCaptureDirectory, verifyBrowserIsolation, verifyCaptureMedia, verifySurfaceCapacity, } from './gummy-cinema-capture-checks.mjs'

const expected = { width: 1920, height: 1080, fps: 60, frames: 480, seconds: 8 }
const probe = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '60/1',
      nb_read_frames: '480',
    },
  ],
  format: { duration: '8.000' },
}

await describe('cinema capture evidence', async () => {
  const isolation = {
    before: { activeWindow: 'user-window-before', activeWorkspace: 1 },
    ownedWindows: [
      {
        address: 'owned-browser',
        class: 'agent-browser',
        workspace: { name: 'special:agents' },
      },
    ],
    activeWindow: { address: 'user-window-after', class: 'user-app' },
    activeWorkspace: { id: 2, name: '2' },
    monitors: [{ specialWorkspace: { name: '' } }],
  }

  await it('allows user app and normal workspace changes while recording the foreground change', () => {
    assert.equal(verifyBrowserIsolation(isolation), true)
    assert.equal(
      verifyBrowserIsolation({
        ...isolation,
        activeWindow: { address: 'user-window-before', class: 'user-app' },
        activeWorkspace: { id: 1, name: '1' },
      }),
      false,
    )
  })

  await it('rejects agent focus by owned address or class and visible agent workspaces', () => {
    assert.throws(
      () =>
        verifyBrowserIsolation({
          ...isolation,
          activeWindow: { address: 'owned-browser', class: 'other-class' },
        }),
      /foreground focus/,
    )
    assert.throws(
      () =>
        verifyBrowserIsolation({
          ...isolation,
          activeWindow: {
            address: 'another-agent-browser',
            class: 'agent-browser',
          },
        }),
      /foreground focus/,
    )
    assert.throws(
      () =>
        verifyBrowserIsolation({
          ...isolation,
          activeWorkspace: { id: -1, name: 'special:agents' },
        }),
      /became active/,
    )
    assert.throws(
      () =>
        verifyBrowserIsolation({
          ...isolation,
          monitors: [{ specialWorkspace: { name: 'special:agents' } }],
        }),
      /became visible/,
    )
  })

  await it('still requires every owned browser window to have the exact class and hidden workspace', () => {
    assert.throws(
      () => verifyBrowserIsolation({ ...isolation, ownedWindows: [] }),
      /Every capture browser/,
    )
    for (const client of [
      {
        address: 'owned-browser',
        class: 'chromium',
        workspace: { name: 'special:agents' },
      },
      {
        address: 'owned-browser',
        class: 'agent-browser',
        workspace: { name: '2' },
      },
    ]) {
      assert.throws(
        () =>
          verifyBrowserIsolation({
            ...isolation,
            ownedWindows: [...isolation.ownedWindows, client],
          }),
        /Every capture browser/,
      )
    }
  })

  await it('accepts native 480-frame landscape and portrait H.264 captures', () => {
    assert.deepEqual(verifyCaptureMedia(probe, expected), {
      codec: 'h264',
      width: 1920,
      height: 1080,
      frames: 480,
      frameRate: '60/1',
      duration: 8,
    })
    const portrait = globalThis.structuredClone(probe)
    portrait.streams[0].width = 1080
    portrait.streams[0].height = 1920
    assert.equal(
      verifyCaptureMedia(portrait, { ...expected, width: 1080, height: 1920 })
        .width,
      1080,
    )
  })

  await it('rejects codec substitution, missing frames, wrong rate and non-native dimensions', () => {
    for (const [key, value] of [
      ['codec_name', 'vp9'],
      ['codec_name', 'hevc'],
      ['nb_read_frames', '479'],
      ['avg_frame_rate', '30/1'],
      ['width', 1280],
    ]) {
      const changed = globalThis.structuredClone(probe)
      changed.streams[0][key] = value
      assert.throws(() => verifyCaptureMedia(changed, expected))
    }
    assert.throws(
      () =>
        verifyCaptureMedia(
          { ...probe, format: { duration: '7.98' } },
          expected,
        ),
      /duration/,
    )
    assert.throws(
      () =>
        verifyCaptureMedia(
          { ...probe, streams: [...probe.streams, { codec_type: 'audio' }] },
          expected,
        ),
      /silent/,
    )
  })

  await it('rejects surface overflow, dropped geometry and empty surfaces', () => {
    const surface = {
      overflow: false,
      droppedVertices: 0,
      vertexCount: 120000,
      capacity: 300000,
    }
    verifySurfaceCapacity(surface)
    assert.throws(() => {
      verifySurfaceCapacity({ ...surface, overflow: true })
    }, /capacity/)
    assert.throws(() => {
      verifySurfaceCapacity({ ...surface, droppedVertices: 3 })
    }, /dropped/)
    assert.throws(() => {
      verifySurfaceCapacity({ ...surface, vertexCount: 0 })
    }, /contain vertices/)
    assert.throws(() => {
      verifySurfaceCapacity({ ...surface, vertexCount: 300003 })
    }, /capacity/)
  })

  await it('preserves an existing recipe-only or empty output directory', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'gummy-capture-check-'))
    const output = path.join(parent, 'take')
    try {
      reserveCaptureDirectory(output)
      assert.throws(() => {
        reserveCaptureDirectory(output)
      }, /will not be overwritten/)
      const recipe = path.join(output, 'recipe.json')
      writeFileSync(recipe, '{"preserved":true}\n')
      assert.throws(() => {
        reserveCaptureDirectory(output)
      }, /will not be overwritten/)
      assert.equal(readFileSync(recipe, 'utf8'), '{"preserved":true}\n')
    } finally {
      rmSync(parent, { recursive: true })
    }
  })
})
