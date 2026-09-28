// Holds both export paths to the live modulation step. Reads their source:
// an export that applied the mappings directly would skip the envelopes and
// the comfort caps, and nothing else would notice.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXPORT_SOURCES = {
  'animationExport.ts': readFileSync(
    join(import.meta.dirname, 'animationExport.ts'),
    'utf8',
  ),
  'OffscreenAnimationRender.tsx': readFileSync(
    join(
      import.meta.dirname,
      '../components/ExportJobs/OffscreenAnimationRender.tsx',
    ),
    'utf8',
  ),
}

describe('export audio wiring', () => {
  it.each(Object.entries(EXPORT_SOURCES))(
    '%s modulates through createExportAudioModulation',
    (_name, source) => {
      expect(source).toContain('createExportAudioModulation(')
      expect(source).not.toContain('applyAudioMappingsToFlame(')
    },
  )
})
