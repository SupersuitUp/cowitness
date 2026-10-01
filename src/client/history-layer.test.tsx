import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { layersIn, withLayer, isLayerOpen, useHistoryLayer } from './history-layer.js'

// A layer is anything that covers the screen without being a page: the photo viewer, the share
// sheet, the upload sheet, the hidden drawer. On the Home Screen there is no browser chrome, no
// back button and no swipe-back, so before this the ONLY way out of one was the small × in the
// corner, and the phone's own back gesture left the page entirely — skipping the thing that was
// actually on screen. Each layer is a history entry now, and back pops it.

describe('the layer stack, as history state', () => {
  it('reads layers off whatever the harness left in history.state, including nothing', () => {
    expect(layersIn(null)).toEqual([])
    expect(layersIn({})).toEqual([])
    expect(layersIn({ usLayers: 'viewer' })).toEqual([])   // not an array: not ours
    expect(layersIn({ usLayers: ['viewer'] })).toEqual(['viewer'])
  })

  it('stacks, and never drops what Next put in the state alongside it', () => {
    const next = { __NA: 'next-internal' }
    const one = withLayer(next, 'viewer')
    expect(one).toMatchObject(next)
    expect(layersIn(one)).toEqual(['viewer'])
    expect(layersIn(withLayer(one, 'sheet'))).toEqual(['viewer', 'sheet'])
  })

  it('knows whether a given layer is in the current entry', () => {
    const s = withLayer(withLayer(null, 'viewer'), 'sheet')
    expect(isLayerOpen(s, 'viewer')).toBe(true)
    expect(isLayerOpen(s, 'sheet')).toBe(true)
    expect(isLayerOpen(s, 'nothing')).toBe(false)
  })
})

function Layer({ id, url }: { id: string; url?: string }) {
  const [open, setOpen] = useState(false)
  const dismiss = useHistoryLayer(id, open, () => setOpen(false), url)
  return (
    <>
      <button onClick={() => setOpen(true)}>open {id}</button>
      {open && <button onClick={dismiss}>close {id}</button>}
      <span data-testid={`state-${id}`}>{open ? 'open' : 'closed'}</span>
    </>
  )
}

describe('useHistoryLayer', () => {
  let push: ReturnType<typeof vi.fn>
  let replace: ReturnType<typeof vi.fn>
  let back: ReturnType<typeof vi.fn>
  let state: unknown

  const pop = (next: unknown) => {
    state = next
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: next })) })
  }

  beforeEach(() => {
    state = null
    push = vi.fn((s: unknown) => { state = s })
    replace = vi.fn((s: unknown) => { state = s })
    // The real back() pops the entry and fires popstate; the test drives that explicitly so it
    // never depends on jsdom's own history timing.
    back = vi.fn()
    vi.spyOn(window.history, 'pushState').mockImplementation(push as never)
    vi.spyOn(window.history, 'replaceState').mockImplementation(replace as never)
    vi.spyOn(window.history, 'back').mockImplementation(back as never)
    vi.spyOn(window.history, 'state', 'get').mockImplementation(() => state)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opening pushes an entry, so the phone has something to go back to', () => {
    render(<Layer id="viewer" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    expect(push).toHaveBeenCalledTimes(1)
    expect(layersIn(push.mock.calls[0][0])).toEqual(['viewer'])
  })

  it('back closes the layer instead of leaving the page', () => {
    render(<Layer id="viewer" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    expect(screen.getByTestId('state-viewer')).toHaveTextContent('open')
    pop(null)   // the entry underneath, with no layers on it
    expect(screen.getByTestId('state-viewer')).toHaveTextContent('closed')
  })

  it('the × goes through history too, so the pushed entry is never left behind', () => {
    render(<Layer id="viewer" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    act(() => { fireEvent.click(screen.getByText('close viewer')) })
    // It asks history to go back rather than closing directly: one path out, so the stack and
    // what is on screen cannot disagree.
    expect(back).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state-viewer')).toHaveTextContent('open')
    pop(null)
    expect(screen.getByTestId('state-viewer')).toHaveTextContent('closed')
  })

  it('a pop that still carries the layer leaves it alone', () => {
    // Two layers deep: popping the sheet must not also close the viewer under it.
    render(<Layer id="viewer" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    pop(withLayer(null, 'viewer'))
    expect(screen.getByTestId('state-viewer')).toHaveTextContent('open')
  })

  it('carries a url, so a reload while open lands back on the same thing', () => {
    render(<Layer id="viewer" url="/m/m1?p=p7" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    expect(push.mock.calls[0][2]).toBe('/m/m1?p=p7')
  })

  it('does not push a second entry when it is already the current one', () => {
    // The arrival case: a push notification opens /m/<id>?p=<photo> and a later re-render must
    // not stack a duplicate entry on top of the one it is already sitting on.
    render(<Layer id="viewer" />)
    act(() => { fireEvent.click(screen.getByText('open viewer')) })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(push).toHaveBeenCalledTimes(1)
  })
})

describe('the × does not depend on popstate arriving', () => {
  // iOS standalone is the Home Screen install, which is where the app actually runs and which cannot
  // be driven from a laptop. So the close button is correct by construction instead: it asks
  // history first, and closes directly if nothing answered. Before any of this the × worked, and
  // the one way this change could have made things worse is by breaking it on a browser whose
  // back() behaves differently.
  it('closes anyway when back() fires no popstate', async () => {
    vi.useFakeTimers()
    try {
      let state: unknown = null
      vi.spyOn(window.history, 'pushState').mockImplementation(((s: unknown) => { state = s }) as never)
      vi.spyOn(window.history, 'back').mockImplementation((() => {}) as never)   // the silent browser
      vi.spyOn(window.history, 'state', 'get').mockImplementation(() => state)

      render(<Layer id="viewer" />)
      act(() => { fireEvent.click(screen.getByText('open viewer')) })
      act(() => { fireEvent.click(screen.getByText('close viewer')) })
      expect(screen.getByTestId('state-viewer')).toHaveTextContent('open')

      act(() => { vi.advanceTimersByTime(300) })
      expect(screen.getByTestId('state-viewer')).toHaveTextContent('closed')
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
