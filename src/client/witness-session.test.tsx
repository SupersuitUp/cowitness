import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { reactionKey } from './reaction-send.js'
import { WitnessSession } from './witness-session.js'
import type { SnapView } from '../types.js'
import { memoryVault, type VaultStore } from './recording-vault.js'

let vault: VaultStore
vi.mock('./recording-vault.js', async (orig) => {
  const real = await orig<typeof import('./recording-vault.js')>()
  return { ...real, indexedDbVault: () => vault }
})

const NAMES = { ana: 'Ana', ben: 'Ben' }
const snap = (id: string, o: Partial<SnapView> = {}): SnapView => ({
  id, by: 'ben', caption: `caption ${id}`, kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3, height: 4,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null,
  createdAt: '2026-09-27T19:00:00.000Z', thumbUrl: `https://img/t${id}`, displayUrl: `https://img/d${id}`, ...o,
})

describe('WitnessSession, typing only', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('shows the oldest first, full screen, with its caption and where it is in the session', () => {
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Witness' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Snap from Ben' })).toHaveAttribute('src', 'https://img/da')
    expect(screen.getByText('caption a')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('says when the snap was taken, not when it was shared', () => {
    const { container } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={() => {}} />)
    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-09-27T14:03:00')
  })

  it('Next with nothing typed marks it witnessed and moves on', async () => {
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/a', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ kind: 'witness' }) }))
    expect(screen.getByText('caption b')).toBeInTheDocument()
  })

  it('Next with words typed sends them with the witness, and clears the box', async () => {
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'you look happy' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ kind: 'witness', text: 'you look happy' }))
    expect(screen.getByLabelText('Say something back')).toHaveValue('')
  })

  it('a failed save stays on the snap and says so', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(screen.getByText('caption a')).toBeInTheDocument()
    expect(screen.getByText('Not saved. Try again.')).toBeInTheDocument()
  })

  it('after the last one: you are all caught up, and Close ends the session', async () => {
    const onClose = vi.fn()
    render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close' })) })
    act(() => { vi.advanceTimersByTime(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
    // Closing by hand cancels the self-close, so it never goes back a second time.
    act(() => { vi.advanceTimersByTime(3000) })
    expect(window.history.back).toHaveBeenCalledTimes(1)
  })

  it('after the last one the session closes itself about two seconds later', async () => {
    const onClose = vi.fn()
    render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={onClose} />)
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1900) })
    expect(window.history.back).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100 + 300) })
    expect(window.history.back).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the header close is named End session, apart from the Close at the end', () => {
    render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('a snap hidden by its poster mid-session (404) is gone, so the session moves on', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(screen.getByText('caption b')).toBeInTheDocument()
    expect(screen.queryByText('Not saved. Try again.')).toBeNull()
  })

  it('walks the queue it opened with, even when the page refreshes a shorter one underneath', async () => {
    const onClose = () => {}
    const { rerender } = render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={onClose} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    rerender(<WitnessSession queue={[snap('b')]} me="ana" names={NAMES} onClose={onClose} />)
    expect(screen.getByText('caption b')).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('a swipe up is the same as Next', async () => {
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={() => {}} />)
    const stage = screen.getByTestId('witness-stage')
    fireEvent.touchStart(stage, { touches: [{ clientY: 600 }] })
    await act(async () => { fireEvent.touchEnd(stage, { changedTouches: [{ clientY: 400 }] }) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/a', expect.anything())
  })

  it('a video plays once, inline, with sound', () => {
    const { container } = render(<WitnessSession me="ana" names={NAMES} onClose={() => {}} queue={[snap('v', { kind: 'video', videoUrl: 'https://v/1', posterUrl: 'https://p/1' })]} />)
    const v = container.querySelector('video')!
    expect(v).toHaveAttribute('src', 'https://v/1')
    expect(v).toHaveAttribute('playsinline')
    expect(v.loop).toBe(false)
    expect(v.muted).toBe(false)
  })
})

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith('audio/webm')
  static made: FakeMediaRecorder[] = []
  state: 'recording' | 'inactive' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public stream: unknown, public opts: { mimeType: string; audioBitsPerSecond?: number }) { FakeMediaRecorder.made.push(this) }
  start() { this.state = 'recording' }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['opus'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

class PutXHR {
  upload = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 200
  open() {}
  setRequestHeader() {}
  send() { setTimeout(() => this.onload?.(), 0) }
}

describe('WitnessSession, with the microphone', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let loud: boolean
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const listen = () => ({ level: () => (loud ? 0.1 : 0.001), close: vi.fn() })
  const urls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}`)
  const bodyOf = (url: string) => JSON.parse((fetchMock.mock.calls.find((c) => c[0] === url)![1] as RequestInit).body as string)

  beforeEach(() => {
    vi.useFakeTimers()
    vault = memoryVault()
    loud = true
    FakeMediaRecorder.made = []
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('XMLHttpRequest', PutXHR)
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/upload-url')) return new Response(JSON.stringify({ url: 'https://put/c9', requiredHeaders: {} }))
      return new Response(JSON.stringify({ id: 'x', comments: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  const open = async (queue = [snap('a'), snap('b')], mic: Promise<MediaStream> = Promise.resolve(stream)) => {
    render(<WitnessSession queue={queue} me="ana" names={NAMES} onClose={() => {}} mic={mic} listen={listen} />)
    await act(async () => { await Promise.resolve() })
  }
  const talkFor = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
  // advanceTimersByTimeAsync runs the microtasks between timers, so the PUT's onload (a 0 ms
  // timer scheduled after the ticket resolves) and the filing call both happen inside it.
  const next = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Next|Done/ })); await vi.advanceTimersByTimeAsync(50) }) }

  it('listens from the first snap, at speech quality, and says so', async () => {
    await open()
    expect(FakeMediaRecorder.made).toHaveLength(1)
    expect(FakeMediaRecorder.made[0].opts).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48_000 })
    expect(screen.getByText('Listening')).toBeInTheDocument()
    expect(screen.queryByLabelText('Say something back')).toBeNull()
  })

  it('what was said is sent as a voice message, the snap is witnessed, and the mic stays on for the next', async () => {
    await open()
    await talkFor(1500)
    await next()
    expect(urls()).toEqual(expect.arrayContaining([
      'POST /api/us/snaps/a/reactions/upload-url', 'POST /api/us/snaps/a/reactions', 'PATCH /api/us/snaps/a',
    ]))
    expect(FakeMediaRecorder.made).toHaveLength(2)
    expect(screen.getByText('caption b')).toBeInTheDocument()
    expect(stop).not.toHaveBeenCalled()
  })

  it('a fresh reaction is filed under the id of the recording it kept on the phone, so a resend can never file it twice', async () => {
    await open()
    await talkFor(1500)
    await next()
    const ticket = bodyOf('/api/us/snaps/a/reactions/upload-url')
    const filed = bodyOf('/api/us/snaps/a/reactions')
    expect(ticket.commentId).toMatch(/^r-/)
    expect(filed.commentId).toBe(ticket.commentId)
    // Sent, so let go of. (Snap b's own recording has already begun.)
    expect((await vault.all()).map((r) => r.noteId)).toEqual(['snap:b'])
  })

  it('silence is not stored: only the witness is sent', async () => {
    loud = false
    await open([snap('a')])
    await talkFor(3000)
    await next()
    expect(urls().filter((u) => u.includes('/reactions'))).toEqual([])
    expect(urls()).toContain('PATCH /api/us/snaps/a')
    expect(await vault.all()).toEqual([])
  })

  it('Next never waits on a recorder the phone already stopped by itself', async () => {
    await open()
    await talkFor(1500)
    // iOS can end a recorder on its own (a call, the app backgrounded). No onstop comes after.
    FakeMediaRecorder.made[0].state = 'inactive'
    await next()
    expect(urls()).toContain('PATCH /api/us/snaps/a')
    expect(screen.getByText('caption b')).toBeInTheDocument()
  })

  it('Next never waits on a recorder that had not started yet', async () => {
    // The phone's store is slow to open, so the recorder exists but has not been started.
    const slow = memoryVault()
    let opened: (() => void) | null = null
    vault = { ...slow, put: (rec) => (opened ? slow.put(rec) : new Promise<void>((r) => { opened = () => { void slow.put(rec).then(r) } })) }
    await open()
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
    await next()
    expect(urls()).toContain('PATCH /api/us/snaps/a')
    expect(screen.getByText('caption b')).toBeInTheDocument()
    // The store catching up late does not start a recorder nobody owns any more.
    await act(async () => { opened!(); await vi.advanceTimersByTimeAsync(10) })
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
  })

  it('a recorder that errors on stop does not hang Next', async () => {
    await open()
    await talkFor(1500)
    const rec = FakeMediaRecorder.made[0]
    rec.stop = () => { rec.state = 'inactive'; rec.onerror?.() }
    await next()
    expect(urls()).toContain('PATCH /api/us/snaps/a')
    expect(screen.getByText('caption b')).toBeInTheDocument()
  })

  it('a recorder that never answers stop still lets Next through, after a short wait', async () => {
    await open()
    await talkFor(1500)
    FakeMediaRecorder.made[0].stop = () => {}
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); await vi.advanceTimersByTimeAsync(50) })
    expect(urls()).not.toContain('PATCH /api/us/snaps/a')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(urls()).toContain('PATCH /api/us/snaps/a')
    expect(screen.getByText('caption b')).toBeInTheDocument()
  })

  it('Type instead after something was said, with nothing typed: what was said is still sent', async () => {
    await open()
    await talkFor(1500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Type instead' })) })
    expect(urls().filter((u) => u.includes('/reactions'))).toEqual([])
    await next()
    expect(urls()).toEqual(expect.arrayContaining([
      'POST /api/us/snaps/a/reactions/upload-url', 'POST /api/us/snaps/a/reactions', 'PATCH /api/us/snaps/a',
    ]))
  })

  // Typed words are the
  // reaction; what was said before is let go of, on the phone and never uploaded.
  it('words typed after something was said: only the words are sent, the recording is let go of', async () => {
    await open()
    await talkFor(1500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Type instead' })) })
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'so good' } })
    await next()
    expect(urls().filter((u) => u.includes('/reactions'))).toEqual([])
    expect(bodyOf('/api/us/snaps/a')).toEqual({ kind: 'witness', text: 'so good' })
    // Let go of on the phone too, a moment later: never kept to be sent another time.
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    // (The next snap is already being listened to; only snap a's recording is gone.)
    expect((await vault.all()).filter((r) => r.noteId === reactionKey('a'))).toEqual([])
  })

  it('while the phone is still asking for the microphone, the box is there to type in', async () => {
    await open([snap('a')], new Promise<MediaStream>(() => {}))
    expect(screen.getByLabelText('Say something back')).toBeInTheDocument()
  })

  it('words typed while the phone was asking are kept, and the mic stays paused for that snap', async () => {
    let grant: (s: MediaStream) => void = () => {}
    await open([snap('a')], new Promise<MediaStream>((r) => { grant = r }))
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'hi' } })
    await act(async () => { grant(stream); await Promise.resolve() })
    expect(screen.getByLabelText('Say something back')).toHaveValue('hi')
    expect(FakeMediaRecorder.made).toHaveLength(0)
  })

  it('granted, but this browser cannot record: the microphone is let go of at once', async () => {
    const trackStop = vi.fn()
    vi.stubGlobal('MediaRecorder', undefined)
    await open([snap('a')], Promise.resolve({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream))
    expect(screen.getByText('The microphone is off. You can type.')).toBeInTheDocument()
    expect(trackStop).toHaveBeenCalled()
  })

  it('granted, but no audio format this browser can make: the microphone is let go of at once', async () => {
    const trackStop = vi.fn()
    FakeMediaRecorder.isTypeSupported = () => false
    try {
      await open([snap('a')], Promise.resolve({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream))
      expect(screen.getByText('The microphone is off. You can type.')).toBeInTheDocument()
      expect(trackStop).toHaveBeenCalled()
    } finally {
      FakeMediaRecorder.isTypeSupported = (t: string) => t.startsWith('audio/webm')
    }
  })

  it('the keyboard pauses the mic for this snap only', async () => {
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Type instead' })) })
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
    expect(screen.getByText('The mic is paused while you type.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'so good' } })
    await next()
    const witness = fetchMock.mock.calls.find((c) => c[0] === '/api/us/snaps/a' && (c[1] as RequestInit).method === 'PATCH')!
    expect((witness[1] as RequestInit).body).toBe(JSON.stringify({ kind: 'witness', text: 'so good' }))
    expect(screen.getByText('Listening')).toBeInTheDocument()
  })

  it('warns in the last thirty seconds and stops itself at three minutes', async () => {
    await open([snap('a')])
    await talkFor(151_000)
    expect(screen.getByText(/stops at 3:00/)).toBeInTheDocument()
    await talkFor(30_000)
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
    expect(screen.getByText('That is three minutes, the most for one snap. Tap Done when you are ready.')).toBeInTheDocument()
  })

  it('what was said before the three minute stop is still sent on Done', async () => {
    await open([snap('a')])
    await talkFor(181_000)
    await next()
    expect(urls()).toContain('POST /api/us/snaps/a/reactions')
  })

  it('with no microphone the session still works by typing', async () => {
    const denied = Promise.reject(new Error('NotAllowedError'))
    denied.catch(() => {}) // handled by the component; this only keeps vitest from reporting it early
    await open([snap('a')], denied)
    expect(screen.getByText('The microphone is off. You can type.')).toBeInTheDocument()
    expect(screen.getByLabelText('Say something back')).toBeInTheDocument()
    expect(FakeMediaRecorder.made).toHaveLength(0)
  })

  const reactionCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/reactions'))
  const witnessCalls = (id: string) => fetchMock.mock.calls.filter((c) => c[0] === `/api/us/snaps/${id}` && (c[1] as RequestInit).method === 'PATCH')

  it('ending mid-snap after something was said saves it as Next would, then leaves', async () => {
    const onClose = vi.fn()
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { unmount } = render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={onClose} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })); await vi.advanceTimersByTimeAsync(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(urls()).toEqual(expect.arrayContaining(['POST /api/us/snaps/a/reactions/upload-url', 'POST /api/us/snaps/a/reactions']))
    expect(bodyOf('/api/us/snaps/a/reactions').commentId).toMatch(/^r-/)
    // Once, however many ways out fired, and only for the snap on screen.
    expect(witnessCalls('a')).toHaveLength(1)
    expect((witnessCalls('a')[0][1] as RequestInit).body).toBe(JSON.stringify({ kind: 'witness' }))
    expect(witnessCalls('b')).toEqual([])
    // Sent, so let go of.
    expect(await vault.all()).toEqual([])
  })

  it('ending mid-snap after talking AND typing sends only the words', async () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { unmount } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={vi.fn()} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(1500)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Type instead' })) })
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'so good' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })); await vi.advanceTimersByTimeAsync(300) })
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(urls().filter((u) => u.includes('/reactions'))).toEqual([])
    expect((witnessCalls('a')[0][1] as RequestInit).body).toBe(JSON.stringify({ kind: 'witness', text: 'so good' }))
    expect(await vault.all()).toEqual([])
  })

  it('ending mid-snap with words typed witnesses the snap with them', async () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const onClose = vi.fn()
    render(<WitnessSession queue={[snap('a'), snap('b')]} me="ana" names={NAMES} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Say something back'), { target: { value: 'you look happy' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })); await vi.advanceTimersByTimeAsync(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(witnessCalls('a')).toHaveLength(1)
    expect((witnessCalls('a')[0][1] as RequestInit).body).toBe(JSON.stringify({ kind: 'witness', text: 'you look happy' }))
    expect(reactionCalls()).toEqual([])
  })

  it('ending mid-snap in silence with nothing typed leaves it waiting and lets go of the empty recording', async () => {
    loud = false
    const onClose = vi.fn()
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { unmount } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={onClose} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })); await vi.advanceTimersByTimeAsync(300) })
    expect(onClose).toHaveBeenCalled()
    expect(FakeMediaRecorder.made[0].state).toBe('inactive')
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(await vault.all()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the back gesture saves what was said, cutting the recording before the microphone is let go of', async () => {
    const onClose = vi.fn(() => { expect(FakeMediaRecorder.made[0].state).toBe('inactive') })
    const { unmount } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={onClose} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    await act(async () => {
      window.history.replaceState({}, '')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(urls()).toContain('POST /api/us/snaps/a/reactions')
    expect(witnessCalls('a')).toHaveLength(1)
  })

  it('the page going away mid-snap saves what was said too', async () => {
    const { unmount } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={() => {}} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(urls()).toContain('POST /api/us/snaps/a/reactions')
    expect(witnessCalls('a')).toHaveLength(1)
  })

  it('leaving after Type instead saves what was said before the keyboard came up', async () => {
    const { unmount } = render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={() => {}} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Type instead' })) })
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(urls()).toContain('POST /api/us/snaps/a/reactions')
    expect(witnessCalls('a')).toHaveLength(1)
    expect(await vault.all()).toEqual([])
  })

  it('a recorder that never answers stop does not hold the way out', async () => {
    const onClose = vi.fn()
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    render(<WitnessSession queue={[snap('a')]} me="ana" names={NAMES} onClose={onClose} mic={Promise.resolve(stream)} listen={listen} />)
    await act(async () => { await Promise.resolve() })
    await talkFor(2000)
    FakeMediaRecorder.made[0].stop = () => {}
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })); await vi.advanceTimersByTimeAsync(300) })
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(witnessCalls('a')).toHaveLength(1)
  })
})
