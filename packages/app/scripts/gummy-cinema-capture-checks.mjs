// Enforce output preservation, exact native media properties, and surface capacity for cinema captures.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export function verifyBrowserIsolation({
  before,
  ownedWindows,
  activeWindow,
  activeWorkspace,
  monitors,
}) {
  assert.ok(
    ownedWindows.length > 0 &&
      ownedWindows.every(
        (client) =>
          client.class === 'agent-browser' &&
          client.workspace.name === 'special:agents',
      ),
    'Every capture browser window must remain on special:agents with class agent-browser',
  )
  assert.ok(
    !ownedWindows.some((client) => client.address === activeWindow.address) &&
      activeWindow.class !== 'agent-browser',
    'An agent browser gained foreground focus',
  )
  assert.notEqual(
    activeWorkspace.name,
    'special:agents',
    'The agent workspace became active',
  )
  assert.ok(
    monitors.every(
      (monitor) => monitor.specialWorkspace.name !== 'special:agents',
    ),
    'The agent workspace became visible on a monitor',
  )
  return (
    activeWindow.address !== before.activeWindow ||
    activeWorkspace.id !== before.activeWorkspace
  )
}

export function reserveCaptureDirectory(output) {
  assert.ok(
    !existsSync(output),
    'Use a new output directory; existing capture files will not be overwritten',
  )
  mkdirSync(path.dirname(output), { recursive: true })
  // No recursive flag on the leaf: another capture winning the reservation also fails safely.
  mkdirSync(output)
}

export function verifyCaptureMedia(probe, expected) {
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  assert.ok(video, 'Capture has no video stream')
  assert.equal(video.codec_name, 'h264', 'Native capture must use H.264')
  assert.equal(video.width, expected.width)
  assert.equal(video.height, expected.height)
  assert.equal(video.avg_frame_rate, `${expected.fps}/1`)
  assert.equal(Number(video.nb_read_frames), expected.frames)
  assert.equal(expected.frames, Math.round(expected.seconds * expected.fps))
  assert.ok(
    Math.abs(Number(probe.format.duration) - expected.seconds) <=
      1 / expected.fps,
    'Native capture has an unexpected duration',
  )
  assert.equal(
    probe.streams.filter((stream) => stream.codec_type === 'audio').length,
    0,
    'Native capture must remain silent; audio belongs in the edit',
  )
  return {
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    frames: Number(video.nb_read_frames),
    frameRate: video.avg_frame_rate,
    duration: Number(probe.format.duration),
  }
}

export function verifySurfaceCapacity(surface) {
  assert.equal(
    surface.overflow,
    false,
    'Captured surface exceeded its vertex capacity',
  )
  assert.equal(surface.droppedVertices, 0, 'Captured surface dropped vertices')
  assert.ok(
    Number.isFinite(surface.vertexCount) &&
      surface.vertexCount > 0 &&
      Number.isFinite(surface.capacity) &&
      surface.vertexCount <= surface.capacity,
    'Captured surface must contain vertices within its capacity',
  )
}
