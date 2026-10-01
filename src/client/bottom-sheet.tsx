'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useHistoryLayer, withLayer } from './history-layer.js'
import { BG, INK, SERIF } from './theme.js'

interface Props {
  title: string
  onClose(): void
  /** While true, nothing closes the sheet: not the ×, the backdrop, or Escape. */
  locked?: boolean
  children: ReactNode
}

// A warm sheet that rises from the bottom over whatever is open, the viewer included.
export function BottomSheet({ title, onClose, locked = false, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const state = useRef({ locked, onClose })
  state.current = { locked, onClose }

  // The sheet is a layer, so the phone's back gesture closes it rather than leaving the page.
  // It is mounted only while open, so being here IS being open. A LOCKED sheet refuses the pop
  // the same way it refuses the ×: an upload in flight is not something a back swipe should
  // abandon, so the entry goes straight back on and the sheet stays where it is.
  const dismiss = useHistoryLayer('sheet', true, () => {
    if (!state.current.locked) { state.current.onClose(); return }
    window.history.pushState(withLayer(window.history.state, 'sheet'), '')
  })
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Capture on window runs before the viewer's own key handler, so Escape or an
    // arrow closes or stays inside this sheet instead of moving the photo behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.key !== 'Escape' && isTyping(e.target)) return
      e.stopPropagation()
      if (e.key === 'Escape' && !state.current.locked) dismissRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={() => { if (!locked) dismiss() }}
      />
      <div
        className="relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        style={{ backgroundColor: BG, color: INK }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl" style={{ fontFamily: SERIF, fontWeight: 500 }}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={dismiss}
            disabled={locked}
            aria-label="Close"
            className="-mr-3 flex h-11 w-11 items-center justify-center text-2xl disabled:opacity-30"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT'
}
