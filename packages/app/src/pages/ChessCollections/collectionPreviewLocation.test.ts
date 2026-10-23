/** Links reproduce art selections while unknown inputs stay within the preview's fixed budgets. */
import { describe, expect, it } from 'vitest'
import { collectionPreviewSearch, readCollectionPreviewSearch, } from './collectionPreviewLocation'

describe('collection preview links', () => {
  const ids = ['tide', 'coral']
  it('restores a complete selection and preserves unrelated URL controls', () => {
    const selection = readCollectionPreviewSearch(
      '?collection=coral&role=queen&side=dark&view=solo&camera=front&quality=high&variation=1&enclosure=both',
      ids,
    )
    expect(selection).toEqual({
      collection: 'coral',
      role: 'queen',
      side: 'dark',
      view: 'solo',
      camera: 'front',
      quality: 'high',
      variation: true,
      enclosure: 'both',
    })
    const search = collectionPreviewSearch(selection, '?debug=1')
    expect(new URLSearchParams(search).get('debug')).toBe('1')
    expect(readCollectionPreviewSearch(search, ids)).toEqual(selection)
  })
  it('falls back on unknown collection, role, view and quality instead of passing arbitrary input to the renderer', () => {
    expect(
      readCollectionPreviewSearch(
        '?collection=missing&role=dragon&side=enemy&view=physics&camera=fly&quality=10000000&variation=true&enclosure=unknown',
        ids,
      ),
    ).toEqual({
      collection: 'tide',
      role: 'pawn',
      side: 'light',
      view: 'board',
      camera: 'perspective',
      quality: 'normal',
      variation: false,
      enclosure: 'pure',
    })
  })
  it('keeps old links on the original pure-fractal presentation', () => {
    expect(
      readCollectionPreviewSearch('?collection=coral&role=rook', ids).enclosure,
    ).toBe('pure')
  })
  it('removes enabled variation from an old link when the toggle is off', () => {
    const selection = readCollectionPreviewSearch('', ids)
    expect(
      new URLSearchParams(
        collectionPreviewSearch(selection, '?variation=1'),
      ).has('variation'),
    ).toBe(false)
  })
})
