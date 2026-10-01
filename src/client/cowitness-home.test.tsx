import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('./add-snap.js', () => ({ AddSnap: () => <button type="button">Add a snap</button> }))
let vault: VaultStore | null = null
vi.mock('./recording-vault.js', async (orig) => {
  const real = await orig<typeof import('./recording-vault.js')>()
  return { ...real, indexedDbVault: () => vault }
})

import { CowitnessHome } from './cowitness-home.js'
import type { SnapView } from '../types.js'
import { memoryVault, type VaultStore } from './recording-vault.js'

const NAMES = { ana: 'Ana', ben: 'Ben' }
const q = (id: string): SnapView => ({
  id, by: 'ben', caption: '', kind: 'photo', takenAt: 'x', width: 1, height: 1,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null, createdAt: '2026-09-27T19:00:00.000Z',
  thumbUrl: 'https://img/t', displayUrl: 'https://img/d',
})

describe('CowitnessHome', () => {
  it('leads with Witness and how many are waiting, which opens the session', () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[q('a'), q('b'), q('c')]} me="ana" names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Witness (3)' }))
    expect(screen.getByRole('dialog', { name: 'Witness' })).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  })
  it('with nothing waiting it says so, and still offers to add a snap', () => {
    render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[]} me="ana" names={NAMES} />)
    expect(screen.queryByRole('button', { name: /Witness/ })).toBeNull()
    expect(screen.getByText('Nothing waiting for you.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a snap' })).toBeInTheDocument()
  })
  it('offers the witnessed shelf, with its count, only when there is something on it', () => {
    const { unmount } = render(<CowitnessHome rows={[]} streak={[]} witnessed={4} queue={[]} me="ana" names={NAMES} />)
    expect(screen.getByRole('link', { name: 'Witnessed (4) ›' })).toHaveAttribute('href', '/cowitness/witnessed')
    expect(screen.getByText('All caught up.')).toBeInTheDocument()
    unmount()
    render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[]} me="ana" names={NAMES} />)
    expect(screen.queryByRole('link', { name: /Witnessed/ })).toBeNull()
  })
  it('ending the session lets go of the microphone', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[q('a')]} me="ana" names={NAMES} />)
      fireEvent.click(screen.getByRole('button', { name: 'Witness (1)' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End session' })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(stopTrack).toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('leaving the page mid-session lets go of the microphone too', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const { unmount } = render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[q('a')]} me="ana" names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Witness (1)' }))
    unmount()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(stopTrack).toHaveBeenCalled()
  })
  it('a reaction an earlier visit could not send goes as soon as the page opens, without waiting for a session', async () => {
    vault = memoryVault()
    await vault.put({ id: 'r-held', noteId: 'snap:a', mimeType: 'audio/webm', createdAt: new Date().toISOString(), durationSec: 4, stopped: true, chunks: [new Blob(['opus'])] })
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(String(url).endsWith('/upload-url') ? { uploaded: true } : { comments: [] })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[]} me="ana" names={NAMES} />)
      await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/us/snaps/a/reactions/upload-url', '/api/us/snaps/a/reactions'])
      expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).commentId).toBe('r-held')
      expect(await vault.all()).toEqual([])
    } finally {
      vault = null
      vi.unstubAllGlobals()
    }
  })
})
