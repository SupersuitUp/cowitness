'use client'

import { useCallback, useEffect, useRef } from 'react'

// A LAYER is anything that covers the screen without being a page: the photo viewer, the share
// sheet, the upload sheet, the hidden drawer. Pages already navigate — every screen carries its
// own way up (‹ Home, ‹ Photos, ‹ Poems) — and layers did not, because nothing in the app ever
// pushed a history entry. `?p=` was written with replaceState, so opening a photo left the stack
// exactly as it was.
//
// That is invisible in a browser and it is the whole experience on a phone. The app is installed to
// the Home Screen (push notifications require it), so it runs standalone: no address bar, no back
// button, and no edge-swipe. The only way out of an open photo was the small × in the corner, and
// the back gesture, where it worked at all, left the page rather than closing the thing on screen.
//
// So each layer becomes a history entry and back pops it. One rule holds the whole thing together:
// there is exactly ONE way out, `history.back()`, and the × goes through it too. A close button
// that cleared state directly would leave its pushed entry behind, and the next back would appear
// to do nothing.

export interface LayerState { usLayers?: string[] }

/** The layers the current history entry is carrying, or none. */
export function layersIn(state: unknown): string[] {
  const l = (state as LayerState | null | undefined)?.usLayers
  return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : []
}

/**
 * The same state with `id` pushed on top. Everything already in it is kept: Next puts its own
 * routing internals in `history.state`, and dropping them breaks the router's idea of where it is.
 */
export function withLayer(state: unknown, id: string): LayerState {
  const base = (state && typeof state === 'object') ? state : {}
  return { ...base, usLayers: [...layersIn(state), id] }
}

export const isLayerOpen = (state: unknown, id: string) => layersIn(state).includes(id)

/**
 * Make one open/closed layer part of the back stack.
 *
 * Returns the dismiss function every close affordance should call: the ×, the backdrop, Escape,
 * a drag-down. It asks history to go back, which fires popstate, which closes the layer. The
 * caller never clears its own state directly, so what is on screen and what the stack says can
 * never disagree.
 *
 * `url` is pushed alongside, so the address survives a reload while the layer is open, and the
 * entry underneath restores the plain address for free when it pops.
 */
export function useHistoryLayer(id: string, open: boolean, close: () => void, url?: string) {
  const closeRef = useRef(close)
  closeRef.current = close
  const pushed = useRef(false)
  // The fallback timer below must never outlive the layer that armed it: a stray one fires into
  // a component that has closed or unmounted, which is a setState on nothing.
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disarm = () => { if (fallback.current !== null) { clearTimeout(fallback.current); fallback.current = null } }

  useEffect(() => {
    if (!open) { pushed.current = false; disarm(); return }

    // Already the current entry: a re-render, or an arrival straight onto a deep link that a
    // previous mount pushed. Pushing again would stack a duplicate, and back would look dead.
    if (!isLayerOpen(window.history.state, id)) {
      window.history.pushState(withLayer(window.history.state, id), '', url)
      pushed.current = true
    }

    const onPop = () => { if (!isLayerOpen(window.history.state, id)) { disarm(); closeRef.current() } }
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener('popstate', onPop); disarm() }
  }, [open, id, url])

  return useCallback(() => {
    // Nothing of ours in the stack (a layer opened before this shipped, or a push that was
    // refused) still has to be closable, or the × would stop working.
    if (!pushed.current && !isLayerOpen(window.history.state, id)) { closeRef.current(); return }
    window.history.back()
    // The × worked before any of this existed and must not become the one thing that stops
    // working on a browser whose back() does not fire popstate the way this assumes. iOS
    // standalone (the Home Screen install, which is where the app actually runs) cannot be tested
    // from a laptop, so the close button does not depend on being right about it: if the layer
    // is still open shortly after, close it directly. On every browser that behaves, popstate
    // has already closed it and this finds nothing to do.
    disarm()
    fallback.current = setTimeout(() => {
      fallback.current = null
      if (isLayerOpen(window.history.state, id)) closeRef.current()
    }, 300)
  }, [id])
}
