/**
 * Validates that struct property names in variation files don't use
 * reserved WGSL words. Catches issues like `{ move: f32 }` at build
 * time instead of waiting for a runtime crash.
 *
 * Invoked from package.json: `tsx scripts/validate-wgsl-props.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Complete list of WGSL reserved words (from the WGSL spec)
const WGSL_RESERVED = new Set([
  // Type keywords
  'array', 'atomic', 'bool', 'f32', 'f64', 'i32', 'u32',
  'mat2x2', 'mat2x3', 'mat2x4',
  'mat3x2', 'mat3x3', 'mat3x4',
  'mat4x2', 'mat4x3', 'mat4x4',
  'ptr', 'sampler', 'sampler_comparison', 'struct',
  'texture_1d', 'texture_2d', 'texture_2d_array', 'texture_3d',
  'texture_cube', 'texture_cube_array',
  'texture_depth_2d', 'texture_depth_2d_array',
  'texture_depth_cube', 'texture_depth_cube_array',
  'texture_multisampled_2d',
  'texture_storage_1d', 'texture_storage_2d', 'texture_storage_2d_array',
  'texture_storage_3d',
  'vec2', 'vec3', 'vec4',
  // Values
  'true', 'false',
  // Statement keywords
  'abstract', 'active', 'align', 'attribute', 'break', 'case', 'compute',
  'const', 'const_assert', 'continue', 'continuing', 'default',
  'diagnostic', 'discard', 'else', 'enable', 'export', 'f16',
  'fallthrough', 'fn', 'for', 'if', 'import', 'let', 'loop', 'move',
  'override', 'private', 'read', 'readonly', 'requires', 'return',
  'storage', 'switch', 'var', 'while', 'workgroup', 'write',
])

interface StructIssue {
  file: string
  line: number
  prop: string
}

function findStructDefinitions(filePath: string): StructIssue[] {
  const source = readFileSync(filePath, 'utf-8')
  const issues: StructIssue[] = []

  // Match struct({ ... }) calls — find the opening { of struct( and then
  // extract top-level property names from the object literal. This handles
  // both single-line and multi-line struct definitions.
  const structRegex = /struct\(\s*\{/
  let match: RegExpExecArray | null
  const re = new RegExp(structRegex.source, 'g')

  while ((match = re.exec(source)) !== null) {
    const startIdx = match.index + match[0].length
    // Find matching closing } by balancing braces
    let depth = 1
    let endIdx = startIdx
    for (let i = startIdx; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      endIdx = i
    }

    const body = source.slice(startIdx, endIdx)
    const lines = source.slice(0, startIdx).split('\n')
    const startLine = lines.length

    // Extract property names: unquoted identifiers before :
    const propRegex = /^\s*(\w+)\s*:/gm
    let propMatch: RegExpExecArray | null
    while ((propMatch = propRegex.exec(body)) !== null) {
      const prop = propMatch[1]
      if (WGSL_RESERVED.has(prop)) {
        // Calculate line number within body
        const bodyPrefix = body.slice(0, propMatch.index)
        const propLine = startLine + bodyPrefix.split('\n').length - 1
        issues.push({ file: filePath, line: propLine, prop })
      }
    }
  }

  return issues
}

function walkDir(dir: string, exts: string[]): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory() && entry !== 'node_modules') {
        files.push(...walkDir(full, exts))
      } else if (st.isFile() && exts.includes(extname(entry))) {
        files.push(full)
      }
    }
  } catch {
    // skip if dir doesn't exist
  }
  return files
}

const variationDirs = [
  join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'app', 'src', 'flame', 'variations'),
]

let errorCount = 0

for (const dir of variationDirs) {
  const files = walkDir(dir, ['.ts', '.tsx'])
  for (const file of files) {
    for (const issue of findStructDefinitions(file)) {
      console.error(
        `\x1b[31mERROR\x1b[0m: ${file}:${issue.line} — ` +
        `struct property '\x1b[1m${issue.prop}\x1b[0m' is a reserved WGSL word. Rename it.`,
      )
      errorCount++
    }
  }
}

if (errorCount > 0) {
  console.error(`\n${errorCount} errors found.`)
  process.exit(1)
}

console.info('\x1b[32mOK\x1b[0m — no WGSL reserved words found in struct property names.')
