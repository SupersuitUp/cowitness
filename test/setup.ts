import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// Route handlers call revalidatePath after mutations; outside a real Next
// request scope it throws, so stub the cache module for unit tests.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// Reset mocks between tests — applies to all environments (node and jsdom)
beforeEach(() => {
  vi.clearAllMocks()
})

// All window-dependent mocks only apply in jsdom environment
if (typeof window !== 'undefined') {
  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // Mock IntersectionObserver
  class MockIntersectionObserver {
    readonly root: Element | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []

    constructor(callback: IntersectionObserverCallback) {
      // Store callback for potential use in tests
      this.callback = callback
    }

    private callback: IntersectionObserverCallback

    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords = vi.fn().mockReturnValue([])
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  })

  // Mock ResizeObserver
  class MockResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }

  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
  })

  // Mock Audio
  class MockAudio {
    src = ''
    currentTime = 0
    duration = 100
    paused = true
    playbackRate = 1
    volume = 1
    muted = false

    play = vi.fn().mockResolvedValue(undefined)
    pause = vi.fn()
    load = vi.fn()
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
  }

  Object.defineProperty(window, 'Audio', {
    writable: true,
    value: MockAudio,
  })

  // Mock localStorage
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  }

  Object.defineProperty(window, 'localStorage', {
    writable: true,
    value: localStorageMock,
  })

  // Mock scrollTo
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
  })

  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()

  // jsdom implements NO Pointer Capture API, so any component calling
  // setPointerCapture inside a pointerdown handler throws from within the event
  // dispatch. Vitest reports that as an unhandled error and warns it can mask
  // real failures — nine of them were coming from the now-playing sheet's
  // drag-to-dismiss. Stubbed here rather than per-test because every component
  // that captures a pointer hits it.
  // jsdom's HTMLMediaElement.play() logs "not implemented" and returns UNDEFINED,
  // so the player store's `audio.play().catch(...)` throws from inside an event
  // handler. Same masking problem as above. Every test gets a promise-returning
  // default; the files that care about real play/pause semantics spy over it.
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  HTMLMediaElement.prototype.pause = vi.fn(() => {})

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
  }

  // Mock window.location
  const locationMock = {
    hash: '',
    pathname: '/',
    search: '',
    href: 'http://localhost:3000/',
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    hostname: 'localhost',
    port: '3000',
    protocol: 'http:',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  }

  Object.defineProperty(window, 'location', {
    writable: true,
    value: locationMock,
  })

  // jsdom does not implement session-history TRAVERSAL. `pushState` and `replaceState` work and
  // update `history.state`, but `history.back()` is a no-op: nothing pops and no popstate is ever
  // dispatched. Measured here rather than assumed, because the failure is silent — a component
  // that closes through history simply never closes, and the test reads as a broken component.
  //
  // Every layer in this app (the photo viewer, every bottom sheet) closes through `back()`, which
  // is the whole point: there is one way out, so what is on screen and what the stack says cannot
  // disagree. Without this, none of that is testable.
  //
  // The one place it is not browser-accurate: a real popstate arrives on a later task, and this
  // dispatches synchronously. Nothing here depends on the gap, and an async dispatch would make
  // every close in every test a `waitFor` for no gain in what is being checked. The behaviour
  // that DOES depend on a real browser (the Home Screen back gesture) is verified in one.
  const entries: { state: unknown; url: string }[] = [{ state: null, url: window.location.href }]
  const realPush = window.history.pushState.bind(window.history)
  const realReplace = window.history.replaceState.bind(window.history)
  window.history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    entries.push({ state, url: String(url ?? window.location.href) })
    realPush(state, title, url as string)
  }
  window.history.replaceState = (state: unknown, title: string, url?: string | URL | null) => {
    entries[entries.length - 1] = { state, url: String(url ?? window.location.href) }
    realReplace(state, title, url as string)
  }
  window.history.back = () => {
    if (entries.length < 2) return
    entries.pop()
    const top = entries[entries.length - 1]
    realReplace(top.state, '', top.url)
    window.dispatchEvent(new PopStateEvent('popstate', { state: top.state }))
  }

  // Reset window-specific mocks between tests (jsdom only)
  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue(null)
    window.location.hash = ''
    entries.length = 1
    entries[0] = { state: null, url: window.location.href }
    realReplace(null, '', window.location.href)
  })
}
