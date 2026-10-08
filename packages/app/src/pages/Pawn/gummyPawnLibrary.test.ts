/** Local pawn snapshots reject ambiguous writes and reopen exact copies without changing Forge drafts. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createGummyAuthoredPawn, gummyAuthoredPawnKey, } from '@/simulation/gummy/gummyAuthoredPawn'
import { GUMMY_PAWN_EDIT_KEY, GUMMY_PAWN_LIBRARY_KEY, gummyPawnForgeUrl, loadGummyPawnLibrary, prepareGummyPawnEdit, readGummyPawnForForge, removeGummyPawnSnapshot, saveGummyPawnSnapshot, } from './gummyPawnLibrary'

const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value)
  },
}
const pawn = (index = 0) =>
  createGummyAuthoredPawn({ openness: index / 10 }, `Pawn ${index}`)
const query = (url: string) => new URL(url, 'https://example.test').search
beforeEach(() => {
  values.clear()
})

describe('local gummy pawn library', () => {
  it('keeps both generation versions distinct and preserves the old trial link', () => {
    const legacy = createGummyAuthoredPawn({}, 'Original', 1)
    const crown = createGummyAuthoredPawn({}, 'Crown', 2)
    saveGummyPawnSnapshot(legacy, undefined, storage)
    saveGummyPawnSnapshot(crown, undefined, storage)
    expect(loadGummyPawnLibrary(storage).pawns).toEqual([legacy, crown])
    expect(
      readGummyPawnForForge('?chessPawn=trial', storage).pawn?.version,
    ).toBe(1)
    expect(
      readGummyPawnForForge(query(gummyPawnForgeUrl()), storage).pawn?.version,
    ).toBe(2)
    expect(
      readGummyPawnForForge(
        query(prepareGummyPawnEdit(legacy, storage)),
        storage,
      ).pawn,
    ).toEqual(legacy)
  })
  it('saves cloned snapshots and rereads independent copies', () => {
    const original = pawn()
    const saved = saveGummyPawnSnapshot(original, undefined, storage)
    original.recipe.openness = 0.9
    saved[0]!.recipe.openness = 0.8
    const first = loadGummyPawnLibrary(storage).pawns
    expect(first[0]).toEqual(pawn())
    first[0]!.name = 'Changed'
    expect(loadGummyPawnLibrary(storage).pawns[0]).toEqual(pawn())
  })
  it('bounds the library at eight without discarding the oldest saved artwork', () => {
    for (let i = 0; i < 8; i++)
      saveGummyPawnSnapshot(pawn(i), undefined, storage)
    const before = storage.getItem(GUMMY_PAWN_LIBRARY_KEY)
    expect(() => saveGummyPawnSnapshot(pawn(8), undefined, storage)).toThrow(
      'Eight pawns',
    )
    expect(storage.getItem(GUMMY_PAWN_LIBRARY_KEY)).toBe(before)
    saveGummyPawnSnapshot(pawn(8), gummyAuthoredPawnKey(pawn()), storage)
    expect(loadGummyPawnLibrary(storage).pawns).toHaveLength(8)
    expect(loadGummyPawnLibrary(storage).pawns.at(-1)).toEqual(pawn(8))
  })
  it('requires unique names and geometry, allowing an explicit update and exact repeat save', () => {
    saveGummyPawnSnapshot(pawn(), undefined, storage)
    expect(saveGummyPawnSnapshot(pawn(), undefined, storage)).toEqual([pawn()])
    expect(() =>
      saveGummyPawnSnapshot({ ...pawn(1), name: 'pAWN 0' }, undefined, storage),
    ).toThrow('name already exists')
    expect(() =>
      saveGummyPawnSnapshot(
        { ...pawn(), name: 'Different' },
        undefined,
        storage,
      ),
    ).toThrow('already saved')
    saveGummyPawnSnapshot(
      { ...pawn(1), name: 'Renamed' },
      gummyAuthoredPawnKey(pawn()),
      storage,
    )
    expect(loadGummyPawnLibrary(storage).pawns[0]?.name).toBe('Renamed')
    expect(() =>
      saveGummyPawnSnapshot(pawn(), gummyAuthoredPawnKey(pawn()), storage),
    ).toThrow('removed')
  })
  it.each(['', ' ', 'unsafe\nname', 'a'.repeat(65)])(
    'rejects unsafe name %j before modifying storage',
    (name) => {
      saveGummyPawnSnapshot(pawn(), undefined, storage)
      const before = storage.getItem(GUMMY_PAWN_LIBRARY_KEY)
      expect(() =>
        saveGummyPawnSnapshot({ ...pawn(1), name }, undefined, storage),
      ).toThrow()
      expect(storage.getItem(GUMMY_PAWN_LIBRARY_KEY)).toBe(before)
    },
  )
  it('preserves damaged, oversized and newer libraries instead of replacing them with an empty list', () => {
    for (const raw of [
      'broken',
      'x'.repeat(40_000),
      JSON.stringify({ format: 'gummy-pawn-library', version: 2, pawns: [] }),
    ]) {
      storage.setItem(GUMMY_PAWN_LIBRARY_KEY, raw)
      expect(loadGummyPawnLibrary(storage).error).toBeTruthy()
      expect(() => saveGummyPawnSnapshot(pawn(), undefined, storage)).toThrow()
      expect(() =>
        removeGummyPawnSnapshot(gummyAuthoredPawnKey(pawn()), storage),
      ).toThrow()
      expect(storage.getItem(GUMMY_PAWN_LIBRARY_KEY)).toBe(raw)
    }
  })
  it('propagates failed storage writes instead of claiming success', () => {
    const blocked = {
      getItem: storage.getItem,
      setItem: () => {
        throw new Error('Storage full')
      },
    }
    expect(() => saveGummyPawnSnapshot(pawn(), undefined, blocked)).toThrow(
      'Storage full',
    )
    expect(loadGummyPawnLibrary(storage).pawns).toEqual([])
  })
  it('reopens a saved snapshot and the exact active snapshot after its library entry changes', () => {
    saveGummyPawnSnapshot(pawn(), undefined, storage)
    expect(
      readGummyPawnForForge(query(gummyPawnForgeUrl(pawn())), storage).pawn,
    ).toEqual(pawn())
    const url = prepareGummyPawnEdit(pawn(), storage)
    removeGummyPawnSnapshot(gummyAuthoredPawnKey(pawn()), storage)
    expect(readGummyPawnForForge(query(url), storage).pawn).toEqual(pawn())
    expect(readGummyPawnForForge('?chessPawn=trial', storage).pawn?.name).toBe(
      'Crystal lattice',
    )
  })
  it('rejects invalid or mismatched edit references without touching prior drafts', () => {
    storage.setItem('chaos-master-pawn-forge-experiments', 'keep this draft')
    prepareGummyPawnEdit(pawn(), storage)
    for (const search of [
      '?chessPawn=',
      '?chessPawn=trial&chessPawn=trial',
      '?chessPawn=anything',
      query(gummyPawnForgeUrl(pawn(1))),
    ]) {
      expect(readGummyPawnForForge(search, storage).error).toBeTruthy()
    }
    expect(readGummyPawnForForge('', storage)).toEqual({})
    expect(storage.getItem('chaos-master-pawn-forge-experiments')).toBe(
      'keep this draft',
    )
    saveGummyPawnSnapshot(pawn(), undefined, storage)
    storage.setItem(GUMMY_PAWN_EDIT_KEY, 'broken')
    expect(
      readGummyPawnForForge(query(gummyPawnForgeUrl(pawn())), storage).pawn,
    ).toEqual(pawn())
  })
})
