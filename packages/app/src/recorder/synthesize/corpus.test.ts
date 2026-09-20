import '@/commands/builtins'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractFlameFromPng } from '@/utils/flameInPng'
import { reportPlan } from './report'
import { SYNTHESIS_STRATEGIES } from './strategies'
import type { SynthesisStrategy } from './strategies'

/**
 * The planner against real flames, on demand.
 *
 * The corpus is hundreds of PNGs that live OUTSIDE the repo (an artist's
 * folders, a downloads directory), so the paths arrive in `SYNTH_CORPUS` —
 * one or more directories, separated by `:` or `,`, scanned recursively:
 *
 *   SYNTH_CORPUS=~/Pictures/chaos npx vitest run src/recorder/synthesize
 *
 * Without it the suite skips, because a test that hard-codes someone's home
 * directory fails for everyone else and proves nothing in CI.
 *
 * What it asserts is narrow and total: every PNG that carries a flame must
 * replay back to that exact flame. How it got there — steps only, or steps
 * plus the closing snap — is reported per file rather than asserted, because
 * that ratio is the coverage measurement this exists to produce.
 */

const CORPUS_DIRS = (process.env.SYNTH_CORPUS ?? '')
  .split(/[:,]/)
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')

function pngsUnder(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) pngsUnder(path, out)
    else if (entry.name.toLowerCase().endsWith('.png')) out.push(path)
  }
  return out
}

describe.skipIf(CORPUS_DIRS.length === 0)(
  'planCreation over a PNG corpus',
  () => {
    const files = CORPUS_DIRS.flatMap((dir) => pngsUnder(dir)).sort()

    it.each(SYNTHESIS_STRATEGIES)(
      'rebuilds every corpus flame with the %s strategy',
      async (strategy: SynthesisStrategy) => {
        const failures: string[] = []
        const stats = {
          flames: 0,
          exact: 0,
          snapped: 0,
          unreadable: 0,
          steps: [] as number[],
        }

        for (const file of files) {
          let payload
          try {
            payload = await extractFlameFromPng(
              new Uint8Array(readFileSync(file)),
            )
          } catch (error) {
            // No FlameJson chunk, or one this build cannot read. Counted rather
            // than ignored: "224 of 226 carry a flame" is only true if the two
            // that do not are the ones we think they are.
            stats.unreadable++
            console.info(
              `[corpus:${strategy}] unreadable ${file}: ${String(error)}`,
            )
            continue
          }
          stats.flames++
          const report = reportPlan(payload, { strategy, seed: 1 })
          stats.steps.push(report.steps)
          if (report.snapped) {
            stats.snapped++
            console.info(
              `[corpus:${strategy}] snapped ${file} after ${report.steps} steps` +
                ` — residual: ${report.residual.slice(0, 6).join(', ')}`,
            )
          } else stats.exact++
          if (!report.ok) {
            failures.push(
              `${file}: ${report.error ?? report.mismatched.slice(0, 4).join(', ')}`,
            )
          }
        }

        const mean =
          stats.steps.length === 0
            ? 0
            : stats.steps.reduce((total, n) => total + n, 0) /
              stats.steps.length
        console.info(
          `[corpus:${strategy}] ${files.length} PNGs, ${stats.flames} flames ` +
            `(${stats.unreadable} without one) — ${stats.exact} exact, ` +
            `${stats.snapped} needed a snap; steps mean ${mean.toFixed(1)}, ` +
            `max ${Math.max(0, ...stats.steps)}`,
        )
        expect(failures).toEqual([])
        expect(stats.flames).toBeGreaterThan(0)
      },
      120_000,
    )
  },
)
