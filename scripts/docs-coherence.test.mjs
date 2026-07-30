import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, matches, report } from './docs-coherence.mjs'

const area = {
  id: 'renderer',
  description: 'Rendering behavior',
  sources: ['src/render/', 'package.json'],
  docs: ['docs/rendering.md'],
  questions: ['Did behavior change?'],
}

void test('matches exact files and directory prefixes without partial matches', () => {
  assert.equal(matches('package.json', 'package.json'), true)
  assert.equal(matches('src/render/pipeline.ts', 'src/render/'), true)
  assert.equal(matches('src/renderer.ts', 'src/render/'), false)
})

void test('marks an area stale when source changes have no matching doc change', () => {
  const [result] = evaluate([area], ['src/render/pipeline.ts'])
  assert.equal(result.stale, true)
  assert.deepEqual(result.changedDocs, [])
})

void test('clears the warning when the mapped documentation changes', () => {
  const [result] = evaluate(
    [area],
    ['src/render/pipeline.ts', 'docs/rendering.md'],
  )
  assert.equal(result.stale, false)
  assert.match(
    report([result], ['src/render/pipeline.ts', 'docs/rendering.md']),
    /✅ renderer/,
  )
})

void test('omits unaffected areas', () => {
  assert.deepEqual(evaluate([area], ['src/unrelated.ts']), [])
})
