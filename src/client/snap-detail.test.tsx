import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

import { SnapDetail } from './snap-detail.js'
import type { SnapView } from '../types.js'

const NAMES = { ana: 'Ana', ben: 'Ben' }
const snap = (o: Partial<SnapView> = {}): SnapView => ({
  id: 's1', by: 'ben', caption: 'the view from work', kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3, height: 4,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null,
  createdAt: '2026-09-27T19:00:00.000Z', thumbUrl: 'https://img/t', displayUrl: 'https://img/d', comments: [], ...o,
})

describe('SnapDetail', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    window.sessionStorage.clear()
    fetchMock = vi.fn(async () => new Response(JSON.stringify(snap({ hiddenAt: 'now' }))))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the photo, its caption and who shared it, with the conversation under it', () => {
    render(<SnapDetail snap={snap()} me="ana" names={NAMES} />)
    expect(screen.getByRole('img', { name: 'Snap from Ben' })).toHaveAttribute('src', 'https://img/d')
    expect(screen.getByText('the view from work')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Say something')).toBeInTheDocument()
  })

  it('plays a video inline with its own controls', () => {
    const { container } = render(<SnapDetail me="ana" names={NAMES} snap={snap({ kind: 'video', video: { path: 'p', posterPath: 'q', durationSec: 3, contentType: 'video/mp4' }, videoUrl: 'https://v/1', posterUrl: 'https://p/1' })} />)
    const video = container.querySelector('video')!
    expect(video).toHaveAttribute('src', 'https://v/1')
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('controls')
  })

  it('only the member who shared it can hide it, and hiding goes back to the archive', async () => {
    const { unmount } = render(<SnapDetail snap={snap()} me="ana" names={NAMES} />)
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    unmount()
    render(<SnapDetail snap={snap()} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/s1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ kind: 'hide' }) }))
    expect(push).toHaveBeenCalledWith('/cowitness')
  })

  it('a hidden snap offers to bring it back', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snap())))
    render(<SnapDetail snap={snap({ hiddenAt: '2026-09-27T20:00:00.000Z' })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bring back' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/s1', expect.objectContaining({ body: JSON.stringify({ kind: 'unhide' }) }))
    expect(refresh).toHaveBeenCalled()
  })

  it('a message goes to the snaps API', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 's1', comments: [{ id: 'c1', by: 'ana', text: 'love it', at: 'now' }] })))
    render(<SnapDetail snap={snap()} me="ana" names={NAMES} />)
    fireEvent.change(screen.getByPlaceholderText('Say something'), { target: { value: 'love it' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/us/snaps/s1')
  })

  it('my snap says who witnessed it, even when they said nothing', () => {
    render(<SnapDetail snap={snap({ by: 'ana', witnessedAt: '2026-09-27T21:00:00.000Z' })} me="ana" names={NAMES} />)
    expect(screen.getByText(/Witnessed by Ben/)).toBeInTheDocument()
  })
  it('the other member\'s snap carries no receipt', () => {
    render(<SnapDetail snap={snap({ witnessedAt: '2026-09-27T21:00:00.000Z' })} me="ana" names={NAMES} />)
    expect(screen.queryByText(/Witnessed by/)).toBeNull()
  })

  it('plays a voice reaction from the snaps audio route', () => {
    render(<SnapDetail me="ben" names={NAMES} snap={snap({ by: 'ben', comments: [{ id: 'c9', by: 'ana', text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/webm', durationSec: 5 } }] })} />)
    expect(screen.getByLabelText('Voice message from Ana')).toHaveAttribute('src', '/api/us/snaps/s1/reactions/c9/audio')
  })

  it('while a reaction is being written down it checks back, and shows the words when they land', async () => {
    vi.useFakeTimers()
    const pending = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' as const } }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snap({ comments: [{ ...pending, text: 'you look happy', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4 } }] }))))
    render(<SnapDetail snap={snap({ comments: [pending] })} me="ben" names={NAMES} />)
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/s1')
    expect(screen.getByText('you look happy')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('stops checking back once nothing is transcribing anymore', async () => {
    vi.useFakeTimers()
    const pending = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' as const } }
    const settled = { ...pending, text: 'hi', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4 } }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snap({ comments: [settled] }))))
    render(<SnapDetail snap={snap({ comments: [pending] })} me="ben" names={NAMES} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('Try again asks the server to transcribe that reaction again', async () => {
    const failed = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'failed' as const, reason: 'x' } }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snap({ comments: [{ ...failed, text: 'bonjour', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4 } }] }))))
    render(<SnapDetail snap={snap({ comments: [failed] })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/s1/reactions/c9/transcribe', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByText('bonjour')).toBeInTheDocument()
  })

  it('Try again on one already retrying says so quietly instead of calling it failed', async () => {
    const failed = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'failed' as const, reason: 'x' } }
    fetchMock.mockResolvedValue(new Response('{}', { status: 409 }))
    render(<SnapDetail snap={snap({ comments: [failed] })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.getByText('Still working on it.')).toBeInTheDocument()
    expect(screen.queryByText(/Could not be transcribed/)).toBeNull()
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
  })

  it('clears "Still working on it." once the reaction is no longer transcribing', async () => {
    vi.useFakeTimers()
    const failed = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'failed' as const, reason: 'x' } }
    const landed = { ...failed, text: 'done', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4 } }
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 409 })
      return new Response(JSON.stringify(snap({ comments: [landed] })))
    })
    render(<SnapDetail snap={snap({ comments: [failed] })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.getByText('Still working on it.')).toBeInTheDocument()
    // The optimistic status is transcribing, so the poll starts; once it lands a finished
    // transcript, there is nothing left to be working on.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.queryByText('Still working on it.')).toBeNull()
    expect(screen.getByText('done')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('a message that lands while an older poll is still in flight is not erased by that poll\'s stale snapshot', async () => {
    vi.useFakeTimers()
    const pending = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' as const } }
    let resolvePoll: (r: Response) => void = () => {}
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ id: 's1', comments: [pending, { id: 'c10', by: 'ben', text: 'hello', at: '2026-09-27T20:02:00.000Z' }] })))
      }
      return new Promise<Response>((res) => { resolvePoll = res })
    })
    render(<SnapDetail snap={snap({ by: 'ana', comments: [pending] })} me="ben" names={NAMES} />)
    // The poll fires and is left in flight.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    // A message is sent and lands before that poll answers.
    fireEvent.change(screen.getByPlaceholderText('Reply'), { target: { value: 'hello' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(screen.getByText('hello')).toBeInTheDocument()
    // Now the older poll resolves, carrying the pre-send snapshot. It must be dropped.
    await act(async () => { resolvePoll(new Response(JSON.stringify(snap({ comments: [pending] })))) })
    expect(screen.getByText('hello')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('a message sent while a retry is in flight survives that retry failing', async () => {
    const failed = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'failed' as const, reason: 'x' } }
    let resolveRetry: (r: Response) => void = () => {}
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>((res) => { resolveRetry = res })
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ id: 's1', comments: [failed, { id: 'c11', by: 'ben', text: 'hey', at: '2026-09-27T20:03:00.000Z' }] })))
      }
      return Promise.resolve(new Response(JSON.stringify(snap({ comments: [failed] }))))
    })
    render(<SnapDetail snap={snap({ comments: [failed] })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    // The retry is left in flight; a message is sent and lands before it answers.
    fireEvent.change(screen.getByPlaceholderText('Reply'), { target: { value: 'hey' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(screen.getByText('hey')).toBeInTheDocument()
    // The retry now fails. It must only update the reaction it was retrying, not erase the
    // message that landed while it was still working.
    await act(async () => { resolveRetry(new Response('{}', { status: 500 })) })
    expect(screen.getByText('hey')).toBeInTheDocument()
    expect(screen.getByText(/Could not be transcribed/)).toBeInTheDocument()
  })

  it('after Try again, a stale reaction does not immediately show Try again again while it re-transcribes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T20:10:00.000Z'))
    const failed = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T19:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'failed' as const, reason: 'x' } }
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (
      init?.method === 'POST' ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify(snap({ comments: [failed] }))))
    ))
    render(<SnapDetail snap={snap({ comments: [failed] })} me="ben" names={NAMES} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    vi.useRealTimers()
  })

  it('a malformed poll response does not stop it checking back', async () => {
    vi.useFakeTimers()
    const pending = { id: 'c9', by: 'ana' as const, text: '', at: '2026-09-27T20:00:00.000Z', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' as const } }
    const landed = { ...pending, text: 'hi', recording: { path: 'p', contentType: 'audio/mp4', durationSec: 4 } }
    let call = 0
    fetchMock.mockImplementation(async () => {
      call += 1
      if (call === 1) return new Response('not json', { status: 200 })
      return new Response(JSON.stringify(snap({ comments: [landed] })))
    })
    render(<SnapDetail snap={snap({ comments: [pending] })} me="ben" names={NAMES} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.getByText('hi')).toBeInTheDocument()
    vi.useRealTimers()
  })
})

describe('SnapDetail with options', () => {
  const voice = (o: Partial<SnapView> = {}): SnapView => ({
    id: 'v1', by: 'ana', caption: '', kind: 'voice', takenAt: 'x', width: 0, height: 0, paths: { original: '', display: '', thumb: '' },
    voice: { path: 'p', contentType: 'audio/mp4', durationSec: 9, text: 'hello there' }, audioUrl: 'https://img/a',
    witnessedAt: '2026-09-30T10:00:00.000Z', witnessedBy: { cy: '2026-09-30T10:00:00.000Z' }, hiddenAt: null,
    createdAt: '2026-09-30T09:00:00.000Z', thumbUrl: null, displayUrl: null, ...o,
  })
  const THREE = { ana: 'Ana', ben: 'Ben', cy: 'Cy' }
  it('plays a voice snap with its words, and lists everyone who has seen it', () => {
    render(<SnapDetail me="ana" names={THREE} snap={voice()} />)
    expect(document.querySelector('audio')).toHaveAttribute('src', 'https://img/a')
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByText(/Seen by Cy/)).toBeInTheDocument()
  })
  it('the voice player knows who is looking: its author is offered the words again, anyone else is not', () => {
    const { unmount } = render(<SnapDetail me="ana" names={THREE} snap={voice()} />)
    expect(screen.getByRole('button', { name: 'Transcribe again' })).toBeInTheDocument()
    unmount()
    render(<SnapDetail me="cy" names={THREE} snap={voice()} />)
    expect(screen.queryByRole('button', { name: 'Transcribe again' })).toBeNull()
  })
  it('names each witness in the order they saw it, and never the people who only read the first seen', () => {
    render(<SnapDetail me="ana" names={THREE} snap={snap({ by: 'ana', witnessedAt: '2026-09-30T10:00:00.000Z', witnessedBy: { cy: '2026-09-30T11:00:00.000Z', ben: '2026-09-30T10:00:00.000Z' } })} />)
    expect(screen.getByText(/· Seen by Ben, Cy$/)).toBeInTheDocument()
    expect(screen.queryByText(/Witnessed by/)).toBeNull()
  })
  it('a person who did not share it is shown no seen at all', () => {
    render(<SnapDetail me="ben" names={THREE} snap={snap({ by: 'ana', witnessedAt: '2026-09-30T10:00:00.000Z', witnessedBy: { cy: '2026-09-30T10:00:00.000Z' } })} />)
    expect(screen.queryByText(/Seen by|Witnessed by/)).toBeNull()
  })
  it('says "just us" and names its tags', () => {
    render(<SnapDetail me="ana" names={NAMES} tagLabels={{ 't-first': 'First', 't-second': 'Second' }} snap={snap({ by: 'ana', justUs: true, tags: ['t-first', 't-second'] })} />)
    expect(screen.getByText('Just us')).toBeInTheDocument()
    expect(screen.getByText('First, Second')).toBeInTheDocument()
  })
})
