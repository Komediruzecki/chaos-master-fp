/** An inspection return takes precedence over old share parameters in the editor address. */
import { render, waitFor } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Wrappers } from './App'
import type { AppProps } from './MainWorkspace'
import type * as JsonQueryParam from './utils/jsonQueryParam'

const ports = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  decodeShare: vi.fn(),
  decodeVariation: vi.fn(),
  receive: vi.fn(),
}))
vi.mock('./flame/chess/chessEditorReturn', () => ({
  isChessEditorReturn: (search: string) =>
    new URLSearchParams(search).get('resume') === 'chess',
  loadChessEditorReturn: ports.loadReturn,
}))
vi.mock('./utils/jsonQueryParam', async (original) => ({
  ...(await original<typeof JsonQueryParam>()),
  decodeSharePayload: ports.decodeShare,
  decodeVariationShare: ports.decodeVariation,
}))
vi.mock('./MainWorkspace', () => ({
  MainWorkspace: (props: AppProps) => {
    ports.receive(props.flameFromQuery)
    return null
  },
}))
vi.mock('./flame/ancestry', () => ({ initAncestry: () => Promise.resolve() }))
vi.mock('./lib/Root', () => ({
  Root: (props: { children?: unknown }) => props.children,
}))

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
})

describe('editor return startup', () => {
  it('restores the retained document instead of decoding stale share or variation links', async () => {
    const returned = {
      flame: { metadata: { name: 'Current authored work' } },
      editorReturnTimeline: { currentFrame: 48 },
    }
    ports.loadReturn.mockReturnValue(returned)
    window.history.replaceState(
      null,
      '',
      '/?resume=chess&flame=old-source&cv=old-variation',
    )
    const view = render(() => <Wrappers />)
    await waitFor(() => {
      expect(ports.receive).toHaveBeenCalledWith(returned)
    })
    expect(ports.decodeShare).not.toHaveBeenCalled()
    expect(ports.decodeVariation).not.toHaveBeenCalled()
    view.unmount()
  })
})
