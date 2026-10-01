import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
let vault: VaultStore | null = null
vi.mock('./recording-vault.js', async (orig) => {
  const real = await orig<typeof import('./recording-vault.js')>()
  return { ...real, indexedDbVault: () => vault }
})
import { VoiceNote } from './voice-note.js'
import { memoryVault, type VaultStore } from './recording-vault.js'

// A recorder as the spec has it: when every track it records has ended, it stops on its own and
// hands over what it had, so a page that only stops the tracks still gets an onstop.
let live: FakeRecorder | null = null
class FakeRecorder {
  static isTypeSupported = () => true
  constructor() { live = this } // eslint-disable-line @typescript-eslint/no-this-alias
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

  describe('a recording the person walks away from', () => {
    const mic = () => {
      const track = { stop: vi.fn(() => { if (live?.state === 'recording') live.stop() }) }
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
      return track
    }
    afterEach(() => { vault = null; live = null })

    it('is dropped on Cancel mid-recording: the microphone off, nothing handed back, nothing held', async () => {
      vi.stubGlobal('MediaRecorder', FakeRecorder)
      const track = mic()
      const store = memoryVault()
      vault = store
      const onRecorded = vi.fn()
      const onCancel = vi.fn()
      render(<VoiceNote onRecorded={onRecorded} onCancel={onCancel} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
      expect(onCancel).toHaveBeenCalled()
      expect(track.stop).toHaveBeenCalled()
      expect(onRecorded).not.toHaveBeenCalled()
      expect(await store.all()).toEqual([])
    })

    it('is dropped when the sheet goes away mid-recording, even though the recorder still reports its stop', async () => {
      vi.stubGlobal('MediaRecorder', FakeRecorder)
      const track = mic()
      const store = memoryVault()
      vault = store
      const onRecorded = vi.fn()
      const { unmount } = render(<VoiceNote onRecorded={onRecorded} onCancel={() => {}} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
      await act(async () => { unmount() })
      expect(track.stop).toHaveBeenCalled()
      expect(onRecorded).not.toHaveBeenCalled()
      expect(await store.all()).toEqual([])
    })

    it('turns the microphone off when it opens after the sheet is gone, and records nothing', async () => {
      vi.stubGlobal('MediaRecorder', FakeRecorder)
      const track = { stop: vi.fn() }
      let open!: (s: unknown) => void
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise((r) => { open = r })) } })
      const store = memoryVault()
      vault = store
      const { unmount } = render(<VoiceNote onRecorded={() => {}} onCancel={() => {}} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
      unmount()
      await act(async () => { open({ getTracks: () => [track] }) })
      expect(track.stop).toHaveBeenCalled()
      expect(live).toBeNull()
      expect(await store.all()).toEqual([])
    })

    it('turns the microphone off when the recorder cannot be made after it opened', async () => {
      vi.stubGlobal('MediaRecorder', Object.assign(function () { throw new Error('no recorder') }, { isTypeSupported: () => true }))
      const track = mic()
      render(<VoiceNote onRecorded={() => {}} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
      expect(track.stop).toHaveBeenCalled()
      expect(screen.getByText(/did not open/)).toBeInTheDocument()
    })

    it('turns the microphone off when the vault refuses the recording after it opened', async () => {
      vi.stubGlobal('MediaRecorder', FakeRecorder)
      const track = mic()
      vault = { get: async () => undefined, put: async () => { throw new Error('quota') }, delete: async () => {}, all: async () => [] }
      render(<VoiceNote onRecorded={() => {}} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record' })) })
      expect(track.stop).toHaveBeenCalled()
      expect(screen.getByText(/did not open/)).toBeInTheDocument()
    })
  })
})
