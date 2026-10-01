import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
let vault: VaultStore | null = null
vi.mock('./recording-vault.js', async (orig) => {
  const real = await orig<typeof import('./recording-vault.js')>()
  return { ...real, indexedDbVault: () => vault }
})
import { VoiceNote } from './voice-note.js'
import { memoryVault, type VaultStore } from './recording-vault.js'

class FakeRecorder {
  static isTypeSupported = () => true
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = 'audio/mp4'
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['ab'], { type: 'audio/mp4' }) }); this.onstop?.() }
}

describe('VoiceNote', () => {
  it('records on one tap, stops on the next, and hands back the recording with its held id', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    const track = { stop: vi.fn() }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
    const onRecorded = vi.fn()
    render(<VoiceNote onRecorded={onRecorded} onCancel={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })) })
    expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ blob: expect.any(Blob), id: expect.stringMatching(/^r-/) }))
    expect(track.stop).toHaveBeenCalled()
  })
  it('holds the recording under the key it is given, so a spoken reply is resent as a reply', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } })
    const store = memoryVault()
    vault = store
    render(<VoiceNote vaultKey={() => 'snap:s1'} onRecorded={() => {}} onCancel={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
    expect((await store.all())[0].noteId).toBe('snap:s1')
  })
  it('draws Cancel only for a caller that gave somewhere for it to go', () => {
    const onCancel = vi.fn()
    const { unmount } = render(<VoiceNote onRecorded={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    unmount()
    render(<VoiceNote onRecorded={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})
