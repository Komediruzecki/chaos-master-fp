/**
 * The app's stylesheets as the glass guards read them (glassBlurs.test.ts,
 * glassSurfaces.test.ts): from disk, since the test runtime turns a CSS
 * module import into class names, and cut into blocks with a small reader
 * of their own rather than a CSS parser, which the app does not depend on.
 *
 * Lives beside the guards rather than in one of them because each needs the
 * same reading of a rule: one copy means a nesting form the reader learns
 * reaches every guard at once.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** packages/app/src, which every stylesheet's `file` is relative to. */
export const SRC = join(import.meta.dirname, '..', '..')

export interface Declaration {
  property: string
  value: string
  line: number
}

export interface Block {
  /** The selector as written: `&:hover` in a nested rule, `@media ...`. */
  selector: string
  /**
   * The selectors the block's declarations apply to, the parents' written
   * in for `&` (or in front of it, where a nested selector has none). An
   * at-rule applies to its parent's; at the top level, to none.
   */
  selectors: string[]
  line: number
  declarations: Declaration[]
}

/**
 * Every block of a stylesheet, each with the declarations written directly
 * in it: a nested rule is a block of its own, so a twin inside `&:hover`
 * does not count for the rule around it. Comments are blanked with their
 * line breaks kept, and nothing inside quotes or parentheses - a url(), an
 * @supports test - ends a declaration or opens a block. The last
 * declaration of a block may go without its semicolon.
 */
export function blocksOf(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  )
  const blocks: Block[] = []
  const open: Block[] = []
  let text = ''
  let textLine = 1
  let line = 1
  let parens = 0
  let quote = ''

  const endStatement = () => {
    const statement = text.trim()
    const colon = statement.indexOf(':')
    const block = open.at(-1)
    if (block && colon > 0) {
      block.declarations.push({
        property: statement.slice(0, colon).trim().toLowerCase(),
        value: statement
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
        line: textLine,
      })
    }
    text = ''
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '\n') line++
    if (!text.trim() && ch.trim()) textLine = line
    if (quote) {
      text += ch
      if (ch === quote && src[i - 1] !== '\\') quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      text += ch
    } else if (ch === '(' || ch === ')') {
      parens += ch === '(' ? 1 : -1
      text += ch
    } else if (parens > 0) {
      text += ch
    } else if (ch === '{') {
      const selector = text.trim().replace(/\s+/g, ' ')
      const block: Block = {
        selector,
        selectors: resolve(selector, open.at(-1)?.selectors ?? []),
        line: textLine,
        declarations: [],
      }
      blocks.push(block)
      open.push(block)
      text = ''
    } else if (ch === '}') {
      endStatement()
      open.pop()
    } else if (ch === ';') {
      endStatement()
    } else {
      text += ch
    }
  }
  return blocks
}

/** A block's selectors, from its own and its parent's. */
function resolve(selector: string, parents: string[]): string[] {
  if (selector.startsWith('@')) return parents
  const own = splitList(selector)
  if (!parents.length) return own
  return parents.flatMap((parent) =>
    own.map((s) =>
      s.includes('&') ? s.replaceAll('&', parent) : `${parent} ${s}`,
    ),
  )
}

/** A selector list cut at its top-level commas. */
export function splitList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts.filter(Boolean)
}

/**
 * The compound a selector styles, its last: `.b:hover` of
 * `[data-theme='dark'] .a > .b:hover`.
 */
export function subjectOf(selector: string): string {
  let depth = 0
  for (let i = selector.length - 1; i >= 0; i--) {
    const ch = selector[i]!
    if (ch === ')' || ch === ']') depth++
    else if (ch === '(' || ch === '[') depth--
    else if (depth === 0 && /[\s>+~]/.test(ch)) return selector.slice(i + 1)
  }
  return selector
}

/** Every file under `dir` whose name passes `test`. */
export function filesUnder(
  dir: string,
  test: (name: string) => boolean,
): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, test))
    else if (test(name)) out.push(full)
  }
  return out
}

export interface Stylesheet {
  /** The path under packages/app/src, with forward slashes. */
  file: string
  raw: string
  /** `raw` with its comments blanked and their line breaks kept. */
  css: string
}

/** Every stylesheet under packages/app/src. */
export function readStylesheets(): Stylesheet[] {
  return filesUnder(SRC, (name) => name.endsWith('.css')).map((full) => {
    const raw = readFileSync(full, 'utf8')
    return {
      file: relative(SRC, full).split('\\').join('/'),
      raw,
      css: raw.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
        comment.replace(/[^\n]/g, ' '),
      ),
    }
  })
}
