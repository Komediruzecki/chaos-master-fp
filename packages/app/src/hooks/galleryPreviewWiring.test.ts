/**
 * MainWorkspace wires the gallery's hover preview into the three places that
 * must see past it.
 *
 * The preview is written into the document silently, and the hook that owns
 * it can take it off (useWorkspaceBlendPick), but only if the workspace asks
 * at the right moments. Mounting MainWorkspace in Vitest mounts the WebGPU
 * renderer too, so this reads its source instead, the way the recorder's UI
 * coverage ratchet does, and the behaviour behind each wire is tested
 * against a world wired the same way (useWorkspaceBlendPick.test.tsx,
 * useWorkspaceAutosave.test.ts):
 *
 * - before every undo and redo, so time travel is computed against the
 *   document its entry describes, not the document with a hover in it;
 * - in every autosave, which stores the document without the preview;
 * - when a breed pick opens the breed gallery, which reads parent A from the
 *   document and must find no blend a quick switch left in it.
 */
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SOURCE = import.meta.glob('../MainWorkspace.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../MainWorkspace.tsx'] as string

const ast = ts.createSourceFile(
  'MainWorkspace.tsx',
  SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

const compact = (node: ts.Node) => node.getText(ast).replace(/\s+/g, ' ').trim()

function callsTo(name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return calls
}

/** The initializer of `property` in the object literal passed to `name`. */
function optionOf(name: string, property: string): string {
  const calls = callsTo(name)
  expect(calls, `expected one call to ${name}`).toHaveLength(1)
  for (const arg of calls[0]!.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === property
      ) {
        return compact(prop.initializer)
      }
    }
  }
  return ''
}

function jsxAttribute(tag: string, attribute: string): string {
  const values: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(ast) === tag
    ) {
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText(ast) === attribute &&
          attr.initializer
        ) {
          values.push(compact(attr.initializer))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  expect(values, `expected one ${tag} with ${attribute}`).toHaveLength(1)
  return values[0]!
}

describe('the gallery hover preview in MainWorkspace', () => {
  it('comes off before every undo and redo', () => {
    expect(optionOf('createStoreHistory', 'onBeforeTimeTravel')).toContain(
      'blendPick.end()',
    )
  })

  it('stays out of every autosave', () => {
    expect(optionOf('useWorkspaceAutosave', 'savedFlame')).toBe(
      'blendPick.withoutPreview',
    )
  })

  it('comes off, both halves of it, before a breed pick reads parent A', () => {
    expect(jsxAttribute('WorkspaceSidebar', 'endBreedPreview')).toBe(
      '{blendPick.end}',
    )
  })
})
