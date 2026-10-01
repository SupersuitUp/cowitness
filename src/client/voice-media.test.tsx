import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { VoiceMedia } from './voice-media.js'
import { configure, type CowitnessClientConfig, clientConfig } from './config.js'
import type { SnapView, VoiceInfo } from '../types.js'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const voiceSnap = (by: string, voice: Partial<VoiceInfo>): SnapView => ({
  id: 'v1', by, caption: '', kind: 'voice', takenAt: NOW.toISOString(), width: 0, height: 0, paths: { original: '', display: '', thumb: '' },
  voice: { path: 'p', contentType: 'audio/mp4', durationSec: 9, text: '', ...voice }, witnessedAt: null, hiddenAt: null,
  createdAt: NOW.toISOString(), displayUrl: '', thumbUrl: '', audioUrl: 'https://img/a',
} as unknown as SnapView)

let before: CowitnessClientConfig | null = null
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  try { before = clientConfig() } catch { before = null }
  configure({ apiBase: '/api/us/snaps', pageBase: '/us', uploadUrls: { photo: '/p', video: '/v' }, vaultName: 'v', renderThread: () => null })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); if (before) configure(before) })

const tryAgain = () => screen.queryByRole('button', { name: /try again|transcribe again/i })

describe('VoiceMedia', () => {
  it('plays the recording with its words', () => {
    const { container } = render(<VoiceMedia snap={voiceSnap('ana', { text: 'hello there' })} me="ben" />)
    expect(container.querySelector('audio')).toHaveAttribute('src', 'https://img/a')
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('offers to transcribe again only where the server would allow it', () => {
    const LATER = '2026-09-30T11:54:00.000Z'
    const cases: [string, Partial<VoiceInfo>, string, boolean][] = [
      ['settled words, the author', { text: 'hi' }, 'ana', true],
      ['settled words, someone else', { text: 'hi' }, 'ben', false],
      ['a failed run, the author', { status: 'failed', reason: 'too quiet' }, 'ana', true],
      ['a failed run, someone else', { status: 'failed', reason: 'too quiet' }, 'ben', true],
      ['a live run, the author', { status: 'transcribing', startedAt: NOW.toISOString() }, 'ana', false],
      ['a live run, someone else', { status: 'transcribing', startedAt: NOW.toISOString() }, 'ben', false],
      ['a stalled run, someone else', { status: 'transcribing', startedAt: LATER }, 'ben', true],
      ['settled words, nobody named', { text: 'hi' }, '', false],
    ]
    for (const [what, voice, me, shown] of cases) {
      const { unmount } = render(<VoiceMedia snap={voiceSnap('ana', voice)} {...(me ? { me } : {})} />)
      expect(Boolean(tryAgain()), what).toBe(shown)
      unmount()
    }
  })

  it('transcribes the same recording again and shows what came back', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(voiceSnap('ana', { text: 'better words' })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<VoiceMedia snap={voiceSnap('ana', { status: 'failed', reason: 'too quiet' })} me="ben" />)
    await act(async () => { fireEvent.click(tryAgain()!) })
    expect(fetchMock).toHaveBeenCalledWith('/api/us/snaps/v1/voice/transcribe', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByText('better words')).toBeInTheDocument()
  })
})
