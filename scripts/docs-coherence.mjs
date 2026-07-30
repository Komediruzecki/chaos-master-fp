#!/usr/bin/env node
/* global process */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function matches(file, pattern) {
  return (
    file === pattern ||
    file.startsWith(pattern.endsWith('/') ? pattern : `${pattern}/`)
  )
}

export function evaluate(areas, changedFiles) {
  return areas
    .map((area) => {
      const changedSources = changedFiles.filter((file) =>
        area.sources.some((source) => matches(file, source)),
      )
      const changedDocs = changedFiles.filter((file) =>
        area.docs.includes(file),
      )
      return {
        ...area,
        changedSources,
        changedDocs,
        stale: changedSources.length > 0 && changedDocs.length === 0,
      }
    })
    .filter(
      (area) => area.changedSources.length > 0 || area.changedDocs.length > 0,
    )
}

function readMap(mapPath) {
  return JSON.parse(readFileSync(path.resolve(root, mapPath), 'utf8'))
}

function gitChangedFiles(base) {
  const args = base
    ? ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]
    : ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']
  const committed = execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const staged = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
  return [
    ...new Set(
      `${committed}\n${staged}\n${untracked}`.split('\n').filter(Boolean),
    ),
  ].sort()
}

function options(args) {
  const valueAfter = (flag) => {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : args[index + 1]
  }
  return {
    base: valueAfter('--base'),
    map: valueAfter('--map') ?? 'docs/coherence-map.json',
    strict: args.includes('--strict'),
  }
}

export function report(results, changedFiles) {
  const lines = [
    '# Documentation coherence report',
    '',
    `Changed files: ${changedFiles.length}`,
    '',
  ]
  if (results.length === 0)
    return `${lines.join('\n')}No mapped documentation areas were affected.\n`

  for (const area of results) {
    lines.push(
      `## ${area.stale ? '⚠️' : '✅'} ${area.id}`,
      '',
      area.description,
      '',
    )
    lines.push(
      `- Code/config changed: ${area.changedSources.join(', ') || 'none'}`,
    )
    lines.push(
      `- Documentation changed: ${area.changedDocs.join(', ') || 'none'}`,
    )
    lines.push(`- Relevant docs: ${area.docs.join(', ')}`)
    if (area.stale) lines.push(`- Review: ${area.questions.join(' ')}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function context(areas) {
  const lines = [
    '# Agent documentation context',
    '',
    'Before editing, identify the areas your task touches. After editing, run `pnpm docs:check --strict`.',
    'A warning means “review these docs”, not “blindly rewrite them”. If no doc change is needed, explain why in the PR.',
    '',
  ]
  for (const area of areas) {
    lines.push(
      `## ${area.id}`,
      area.description,
      `Sources: ${area.sources.join(', ')}`,
      `Docs: ${area.docs.join(', ')}`,
    )
    lines.push(...area.questions.map((question) => `- ${question}`), '')
  }
  return `${lines.join('\n')}\n`
}

function main() {
  const [command = 'check', ...args] = process.argv.slice(2)
  const flags = options(args)
  const { areas } = readMap(flags.map)
  if (command === 'context') {
    process.stdout.write(context(areas))
    return
  }
  if (command !== 'check') throw new Error(`Unknown command: ${command}`)

  const changedFiles = gitChangedFiles(flags.base)
  const results = evaluate(areas, changedFiles)
  process.stdout.write(report(results, changedFiles))
  if (flags.strict && results.some((area) => area.stale)) process.exitCode = 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
