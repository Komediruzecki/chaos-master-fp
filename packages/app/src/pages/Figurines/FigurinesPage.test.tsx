/** Live study selection, native exports and lifecycle without a GPU or draft mutations. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library'
import { onMount } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFigurine, FIGURINE_COLLECTIONS, } from '@/flame/chess/figurineCollections'
import { validateFlame } from '@/flame/schema/flameSchema'
import { FigurinesPage } from './FigurinesPage'
import type { PawnStageProps } from '@/components/PawnStage/PawnStage'

const stubs = vi.hoisted(() => ({
  stage: undefined as PawnStageProps | undefined,
  mounts: 0,
  download: vi.fn<(blob: Blob, filename: string) => void>(),
}))

vi.mock('@/utils/blob', () => ({ downloadBlob: stubs.download }))
vi.mock('@/components/PawnStage/PawnStage', () => ({
  PawnStage: (props: PawnStageProps) => {
    stubs.stage = props
    onMount(() => {
      stubs.mounts++
      props.onStatusChange?.({
        pointCount: 5_000_000,
        progress: 1,
        ready: true,
      })
    })
    return (
      <div
        role="group"
        aria-label={props.ariaLabel}
        data-testid="study-stage"
      />
    )
  },
}))

const stored = new Map<string, string>()
const writeStorage = vi.fn((key: string, value: string) => {
  stored.set(key, value)
})
const memoryStorage: Storage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: writeStorage,
  removeItem: (key) => {
    stored.delete(key)
  },
  clear: () => {
    stored.clear()
  },
  key: (index) => [...stored.keys()][index] ?? null,
  get length() {
    return stored.size
  },
}
let oldTitle: string

beforeEach(() => {
  stored.clear()
  stored.set(
    'chaos-master-pawn-forge-experiments',
    'existing independent forms',
  )
  stored.set('chaos-master-pawn-forge-draft', 'existing glass pawn')
  writeStorage.mockClear()
  vi.stubGlobal('localStorage', memoryStorage)
  stubs.download.mockClear()
  stubs.stage = undefined
  stubs.mounts = 0
  oldTitle = document.title
})
afterEach(() => {
  cleanup()
  document.title = oldTitle
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stage() {
  if (!stubs.stage) throw new Error('No study stage was mounted')
  return stubs.stage
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('The study export was not text'))
    }
    reader.onerror = () => {
      reject(new Error('Failed to read the study export'))
    }
    reader.readAsText(blob)
  })
}

describe('FigurinesPage', () => {
  it('starts with flame experiments and compares all eight native designs in one mounted stage', () => {
    render(() => <FigurinesPage />)
    expect(stage().flame).toEqual(buildFigurine('aurora-queen', 'light'))
    expect(screen.getByText('Authored / Human scale')).toBeTruthy()
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Flame experiments' })
        .checked,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Authored' }).checked,
    ).toBe(true)
    expect(screen.queryByRole('radio', { name: 'Frost' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Preview settled')
    expect(screen.getByText('5.0M samples')).toBeTruthy()
    for (const collection of FIGURINE_COLLECTIONS) {
      fireEvent.click(screen.getByRole('radio', { name: collection.name }))
      expect(screen.getByText(collection.description)).toBeTruthy()
      for (const item of collection.figurines) {
        fireEvent.click(screen.getByRole('radio', { name: item.name }))
        expect(stage().flame).toEqual(buildFigurine(item.id, 'light'))
        expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
          item.name,
        )
        expect(screen.getByText(item.description)).toBeTruthy()
        expect(screen.getByText(item.fractureHint)).toBeTruthy()
      }
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Geometric studies' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ember' }))
    expect(screen.getByText('Ember / 1.8 m')).toBeTruthy()
    expect(stage().flame).toEqual(buildFigurine('branching-knight', 'dark'))
    expect(stubs.mounts).toBe(1)
    expect(screen.getAllByTestId('study-stage')).toHaveLength(1)
  })

  it('remembers each collection selection and palette without persisting them', () => {
    render(() => <FigurinesPage />)
    const flameCollection = FIGURINE_COLLECTIONS[0]!
    const geometricCollection = FIGURINE_COLLECTIONS[1]!
    const flameKnight = flameCollection.figurines.find(
      (item) => item.id === 'tidal-knight',
    )!
    const rook = geometricCollection.figurines.find(
      (item) => item.id === 'menger-rook',
    )!
    fireEvent.click(screen.getByRole('radio', { name: flameKnight.name }))
    fireEvent.click(screen.getByRole('radio', { name: 'Alternate' }))
    expect(stage().flame).toEqual(buildFigurine('tidal-knight', 'dark'))
    const switchKey = stage().resetViewKey!
    fireEvent.click(screen.getByRole('radio', { name: 'Geometric studies' }))
    expect(stage().resetViewKey).toBe(switchKey + 1)
    expect(stage().flame).toEqual(buildFigurine('lattice-pawn', 'light'))
    expect(screen.queryByRole('radio', { name: 'Alternate' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: rook.name }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ember' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Flame experiments' }))
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: flameKnight.name })
        .checked,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Alternate' })
        .checked,
    ).toBe(true)
    expect(stage().flame).toEqual(buildFigurine('tidal-knight', 'dark'))
    fireEvent.click(screen.getByRole('radio', { name: 'Geometric studies' }))
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: rook.name }).checked,
    ).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Ember' }).checked,
    ).toBe(true)
    expect(stage().flame).toEqual(buildFigurine('menger-rook', 'dark'))
    expect(stubs.mounts).toBe(1)
    expect(writeStorage).not.toHaveBeenCalled()
  })

  it('resets only the camera and never writes either Forge draft', () => {
    render(() => <FigurinesPage />)
    fireEvent.click(screen.getByRole('radio', { name: 'Geometric studies' }))
    const rook = FIGURINE_COLLECTIONS[1]!.figurines.find(
      (item) => item.id === 'menger-rook',
    )!
    fireEvent.click(screen.getByRole('radio', { name: rook.name }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ember' }))
    const descriptor = stage().flame
    const key = stage().resetViewKey!
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(stage().resetViewKey).toBe(key + 1)
    expect(stage().flame).toBe(descriptor)
    expect(
      screen.getByRole<HTMLInputElement>('radio', {
        name: 'Ember',
      }).checked,
    ).toBe(true)
    expect(stored.get('chaos-master-pawn-forge-experiments')).toBe(
      'existing independent forms',
    )
    expect(stored.get('chaos-master-pawn-forge-draft')).toBe(
      'existing glass pawn',
    )
    expect(writeStorage).not.toHaveBeenCalled()
  })

  it.each([
    {
      collection: 'Flame experiments',
      id: 'ember-bishop' as const,
      palette: 'Alternate',
    },
    {
      collection: 'Geometric studies',
      id: 'sierpinski-bishop' as const,
      palette: 'Ember',
    },
  ])(
    'downloads the native $id descriptor with its groups and variations intact',
    async ({ collection, id, palette }) => {
      render(() => <FigurinesPage />)
      fireEvent.click(screen.getByRole('radio', { name: collection }))
      const bishop = FIGURINE_COLLECTIONS.flatMap(
        (item) => item.figurines,
      ).find((item) => item.id === id)!
      fireEvent.click(screen.getByRole('radio', { name: bishop.name }))
      fireEvent.click(screen.getByRole('radio', { name: palette }))
      fireEvent.click(
        screen.getByRole('button', { name: 'Download native JSON' }),
      )
      expect(stubs.download).toHaveBeenCalledTimes(1)
      const [blob, filename] = stubs.download.mock.calls[0]!
      expect(filename).toBe(`fractal-${id}-dark.json`)
      expect(blob.type).toBe('application/json')
      const payload = JSON.parse(await readBlob(blob)) as {
        format: string
        version: number
        studyId: string
        side: string
        flame: unknown
      }
      expect(payload.format).toBe('lumen-fractal-figurine-study')
      expect(payload.version).toBe(1)
      expect(payload.studyId).toBe(id)
      expect(payload.side).toBe('dark')
      expect(validateFlame(payload.flame)).toEqual(buildFigurine(id, 'dark'))
      expect(writeStorage).not.toHaveBeenCalled()
    },
  )

  it('restores page metadata and exposes the existing forge and board routes', () => {
    document.title = 'Previous page'
    const robotsBefore = document.head.querySelectorAll(
      'meta[name="robots"]',
    ).length
    const mounted = render(() => <FigurinesPage />)
    expect(document.title).toBe('Figurine studies · Lumen Apeiron')
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(
      robotsBefore + 1,
    )
    expect(
      screen
        .getByRole<HTMLAnchorElement>('link', { name: 'Pawn Forge' })
        .getAttribute('href'),
    ).toBe('/pawn')
    expect(
      screen
        .getByRole<HTMLAnchorElement>('link', { name: 'Pawn board' })
        .getAttribute('href'),
    ).toBe('/chess')
    expect(screen.getByText(/The board still plays pawns/)).toBeTruthy()
    mounted.unmount()
    expect(document.title).toBe('Previous page')
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(
      robotsBefore,
    )
  })
})
