import { createRoot } from 'solid-js'
import { createStore } from 'solid-js/store'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFlameXml } from '@/flame/flameXml'
import { useWorkspaceAutosave } from '@/hooks/useWorkspaceAutosave'
import workspaceSource from '@/MainWorkspace.tsx?raw'
import { clearRecentFlames, loadRecentFlames } from '@/utils/recentFlames'
import { replaceOpenDocument } from './documentLoad'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

// Same reason as draft.test.ts: localStorage is not usable in this runtime,
// so Recents round-trips through an in-memory store.
const store = new Map<string, string>()
vi.mock('@/utils/storage', () => ({
  safeGetItem: (key: string) => store.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    store.set(key, value)
    return true
  },
  safeRemoveItem: (key: string) => {
    store.delete(key)
  },
}))

const parsed = parseFlameXml(`<?xml version="1.0" encoding="UTF-8"?>
<flame name="Open" version="Apophysis 7X" size="800 600"
       center="0 0" scale="200" oversample="1" filter="0.5"
       quality="100" background="0 0 0" brightness="4" gamma="2.2">
  <xform weight="1" color="0" linear="1" coefs="1 0 0 1 0 0"/>
</flame>`)
const flame: FlameDescriptor = {
  ...parsed,
  metadata: { ...parsed.metadata, name: 'Open' },
}

afterEach(clearRecentFlames)

describe('replacing the open document', () => {
  it('puts the outgoing flame in Recents before the incoming one lands', () => {
    // The Library chokepoint, with the editor's own autosave doing the
    // flushing. Every way into the load dialog reaches this order; the
    // desktop's Load button once had it and the touch layouts' way in did
    // not, so opening a flame on a phone dropped whatever was unsaved.
    createRoot((dispose) => {
      const [open, setOpen] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: open,
        getTracks: () => [],
        getConfig: () => undefined,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()
      setOpen('metadata', 'name', 'Unsaved work')
      expect(autosave.isFlameDirty()).toBe(true)

      replaceOpenDocument({
        flushUnsaved: autosave.flushDirtyToRecents,
        replace: () => {
          setOpen('metadata', 'name', 'Opened from Library')
        },
      })

      // What reached Recents is what was being edited, not what replaced it.
      const recents = loadRecentFlames()
      expect(recents).toHaveLength(1)
      expect(recents[0]?.flame.metadata?.name).toBe('Unsaved work')
      dispose()
    })
  })

  it('is where every replacement in the workspace flushes', () => {
    // The claim this module makes about itself, checked rather than
    // asserted: a replacement that flushes by hand is one edit away from
    // flushing after the replacement, or not at all, which is the bug that
    // put this module here. Passing the flush to the chokepoint as a value
    // is the only form allowed; a call of its own is what this catches.
    const ast = ts.createSourceFile(
      'MainWorkspace.tsx',
      workspaceSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const byHand: string[] = []
    const walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'flushDirtyToRecents'
      ) {
        const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
        byHand.push(`MainWorkspace.tsx:${line + 1}`)
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
    expect(byHand).toEqual([])
  })

  it('gives a replacement with no animation a timeline of its own', () => {
    // The timeline is part of the document: the frame rate, the end frame and
    // the loop mode. The effect that consumes a load applies the config it is
    // handed, and a load that hands none leaves whatever the document before
    // it was running at - so New Flame, which carries no animation at all,
    // opened the starter flame at the last flame's 60fps over 300 frames. The
    // hand-off path is not in this: it resets the timeline itself before
    // seeding, and it passes the restored draft's config through.
    const ast = ts.createSourceFile(
      'MainWorkspace.tsx',
      workspaceSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const named = (property: ts.ObjectLiteralElementLike, name: string) =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    const inherited: string[] = []
    const walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'setLoadedAnimation' &&
        node.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const seed = node.arguments[0]
        const carriesNoTracks = seed.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            named(property, 'tracks') &&
            ts.isArrayLiteralExpression(property.initializer) &&
            property.initializer.elements.length === 0,
        )
        const saysTimeline = seed.properties.some((property) =>
          named(property, 'config'),
        )
        if (carriesNoTracks && !saysTimeline) {
          const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
          inherited.push(`MainWorkspace.tsx:${line + 1}`)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(ast)
    expect(inherited).toEqual([])
  })

  it('writes nothing when the open document holds nothing unsaved', () => {
    createRoot((dispose) => {
      const [open, setOpen] = createStore<FlameDescriptor>(
        JSON.parse(JSON.stringify(flame)),
      )
      const autosave = useWorkspaceAutosave({
        flameDescriptor: open,
        getTracks: () => [],
        getConfig: () => undefined,
        agentDriving: () => false,
        showToast: () => undefined,
      })
      autosave.markLoadedBaseline()

      replaceOpenDocument({
        flushUnsaved: autosave.flushDirtyToRecents,
        replace: () => {
          setOpen('metadata', 'name', 'Opened from Library')
        },
      })

      expect(loadRecentFlames()).toHaveLength(0)
      dispose()
    })
  })
})
