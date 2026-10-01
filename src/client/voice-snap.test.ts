import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { beginRecording, endRecording, keepChunk, keepMeta, memoryVault, newRecordingId } from './recording-vault.js'
import { sendHeldVoiceSnaps, sendVoiceSnap, voiceSnapKey } from './voice-snap.js'
import { configure, clientConfig, type CowitnessClientConfig } from './config.js'

const fetchMock = vi.fn()
let before: CowitnessClientConfig | null = null
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  try { before = clientConfig() } catch { before = null }
  configure({ apiBase: '/api/us/snaps', pageBase: '/us', uploadUrls: { photo: '/p', video: '/v' }, vaultName: 'v', renderThread: () => null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (before) configure(before)
})
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const refused = (status: number) => new Response('{"error":"no"}', { status })
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body)

// A PUT the test can see: every header it set, and the status the test chose for it.
const puts: { url: string; headers: Record<string, string>; status: number }[] = []
function fakeXhr(statuses: number[]) {
  puts.length = 0
  class FakeXhr {
    status = 0
    upload = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    private put = { url: '', headers: {} as Record<string, string>, status: 0 }
    open(_m: string, url: string) { this.put.url = url }
    setRequestHeader(k: string, v: string) { this.put.headers[k] = v }
    send() { this.status = statuses.shift() ?? 200; this.put.status = this.status; puts.push(this.put); this.onload?.() }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
}

describe('sendVoiceSnap', () => {
  it('asks for a ticket, sends the bytes, then files the snap under the same id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ snapId: 'v-abcdefgh', uploaded: true })).mockResolvedValueOnce(ok({ id: 'v-abcdefgh', kind: 'voice' }))
    await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: 'hi', language: 'fr', justUs: true, tags: ['t-first'] })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/us/snaps/voice/upload-url')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/us/snaps/voice')
    expect(bodyOf(1)).toEqual({ snapId: 'v-abcdefgh', contentType: 'audio/mp4', durationSec: 4, caption: 'hi', language: 'fr', justUs: true, tags: ['t-first'] })
  })
  it('throws when the filing is refused, so the caller keeps the recording', async () => {
    fetchMock.mockResolvedValueOnce(ok({ snapId: 'v-abcdefgh', uploaded: true })).mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await expect(sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })).rejects.toThrow()
  })

  it('sends the ticket\'s required headers on the PUT exactly as issued, the uploader stamp included', async () => {
    fakeXhr([200])
    const requiredHeaders = {
      'Content-Type': 'audio/mp4', 'x-goog-content-length-range': '0,1000', 'x-goog-if-generation-match': '0', 'x-goog-meta-cowitness-by': 'ana',
    }
    fetchMock.mockResolvedValueOnce(ok({ snapId: 'v-abcdefgh', url: 'https://storage/put', requiredHeaders })).mockResolvedValueOnce(ok({ id: 'v-abcdefgh' }))
    await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })
    expect(puts).toEqual([{ url: 'https://storage/put', headers: requiredHeaders, status: 200 }])
  })

  describe('an id the server will not take', () => {
    const ticket = (id: string) => ok({ snapId: id, url: `https://storage/${id}`, requiredHeaders: { 'Content-Type': 'audio/mp4' } })

    it.each([403, 412])('after a %i on the PUT, mints a fresh id, says so, and sends once more under it', async (status) => {
      fakeXhr([status, 200])
      fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
        const id = JSON.parse(init.body).snapId as string
        return url.endsWith('/upload-url') ? ticket(id) : ok({ id })
      })
      const onNewId = vi.fn()
      const snap = await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: 'hi' }, { onNewId })
      const fresh = onNewId.mock.calls[0][0] as string
      expect(fresh).not.toBe('v-abcdefgh')
      expect(fresh).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
      expect(puts.map((p) => p.url)).toEqual(['https://storage/v-abcdefgh', `https://storage/${fresh}`])
      expect(snap.id).toBe(fresh)
    })

    it.each([403, 409])('after a %i on the ticket that the id is not this phone\'s, sends under a fresh id', async (status) => {
      fakeXhr([200])
      const answers = [refused(status), ...(status === 409 ? [refused(409)] : [])]
      fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
        const next = answers.shift()
        if (next) return next
        const id = JSON.parse(init.body).snapId as string
        return url.endsWith('/upload-url') ? ticket(id) : ok({ id })
      })
      const onNewId = vi.fn()
      const snap = await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' }, { onNewId })
      expect(snap.id).toBe(onNewId.mock.calls[0][0])
      expect(snap.id).not.toBe('v-abcdefgh')
    })

    it('after a 409 on the ticket, takes back this phone\'s own snap rather than filing a second one', async () => {
      fetchMock.mockResolvedValueOnce(refused(409)).mockResolvedValueOnce(ok({ id: 'v-abcdefgh', kind: 'voice' }))
      const onNewId = vi.fn()
      const snap = await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' }, { onNewId })
      expect(snap.id).toBe('v-abcdefgh')
      expect(onNewId).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('after a 403 on the filing, sends under a fresh id', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ snapId: 'v-abcdefgh', uploaded: true }))
        .mockResolvedValueOnce(refused(403))
        .mockResolvedValueOnce(ok({ uploaded: true }))
        .mockImplementationOnce(async (_u: string, init: { body: string }) => ok({ id: JSON.parse(init.body).snapId }))
      const snap = await sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })
      expect(snap.id).not.toBe('v-abcdefgh')
      expect(bodyOf(2).snapId).toBe(snap.id)
    })

    it('tries a fresh id once only, then throws so the recording stays held', async () => {
      fakeXhr([412, 412, 412])
      fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
        const id = JSON.parse(init.body).snapId as string
        return url.endsWith('/upload-url') ? ticket(id) : ok({ id })
      })
      await expect(sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })).rejects.toThrow()
      expect(puts).toHaveLength(2)
    })

    it('does not change the id for any other failure', async () => {
      fetchMock.mockResolvedValueOnce(refused(500))
      const onNewId = vi.fn()
      await expect(sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' }, { onNewId })).rejects.toThrow()
      expect(onNewId).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('the ids a recording is held and filed under', () => {
  it('come from the platform\'s cryptographic randomness, never Math.random', () => {
    const random = vi.spyOn(Math, 'random')
    const crypto = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const id = newRecordingId()
    expect(crypto).toHaveBeenCalled()
    expect(random).not.toHaveBeenCalled()
    expect(id).toMatch(/^r-[A-Za-z0-9_-]{8,62}$/)
    random.mockRestore()
    crypto.mockRestore()
  })
  it('carry at least 64 random bits, so two phones never mint the same one', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newRecordingId()))
    expect(ids.size).toBe(2000)
    const tail = newRecordingId().split('-').pop()!
    expect(tail.length * 4).toBeGreaterThanOrEqual(64)
  })
})

describe('sendHeldVoiceSnaps', () => {
  it('sends a finished held voice note with what was typed for it, and lets it go once filed', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: 'v-abcdefgh', noteId: voiceSnapKey('v-abcdefgh'), mimeType: 'audio/mp4' })
    await keepChunk(store, 'v-abcdefgh', new Blob(['ab']), 2)
    await endRecording(store, 'v-abcdefgh', 2)
    await keepMeta(store, 'v-abcdefgh', { caption: 'evening' })
    const send = vi.fn(async () => ({}) as never)
    expect(await sendHeldVoiceSnaps(store, send)).toBe(1)
    expect(send).toHaveBeenCalledWith(expect.any(Blob), 2, 'v-abcdefgh', { caption: 'evening' }, expect.anything())
    expect(await store.all()).toEqual([])
  })
  it('leaves a reaction\'s recording and an unfinished one alone', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: 'r-abcdefgh', noteId: 'snap:s1', mimeType: 'audio/mp4' })
    await beginRecording(store, { id: 'v-unfinished', noteId: voiceSnapKey('v-unfinished'), mimeType: 'audio/mp4' })
    await keepChunk(store, 'v-unfinished', new Blob(['ab']), 1)
    expect(await sendHeldVoiceSnaps(store, vi.fn())).toBe(0)
  })
  it('re-keeps a held note under the fresh id it was sent as, so a later resend files that one', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: 'v-abcdefgh', noteId: voiceSnapKey('v-abcdefgh'), mimeType: 'audio/mp4' })
    await keepChunk(store, 'v-abcdefgh', new Blob(['ab']), 2)
    await endRecording(store, 'v-abcdefgh', 2)
    const send = vi.fn(async (_b: Blob, _d: number, _id: string, _m: unknown, opts?: { onNewId?(id: string): Promise<void> | void }) => {
      await opts?.onNewId?.('r-freshfresh')
      throw new Error('lost again')
    })
    expect(await sendHeldVoiceSnaps(store, send as never)).toBe(0)
    expect((await store.all())[0].noteId).toBe(voiceSnapKey('r-freshfresh'))
  })

  describe('a refusal that will never change', () => {
    const held = async () => {
      const store = memoryVault()
      await beginRecording(store, { id: 'v-abcdefgh', noteId: voiceSnapKey('v-abcdefgh'), mimeType: 'audio/mp4' })
      await keepChunk(store, 'v-abcdefgh', new Blob(['ab']), 2)
      await endRecording(store, 'v-abcdefgh', 2)
      await keepMeta(store, 'v-abcdefgh', { caption: 'evening', justUs: true })
      return store
    }
    const failing = (err: unknown) => vi.fn(async () => { throw err })

    it.each([400, 403, 404])('lets a held note go after a %i, and says so once', async (status) => {
      const store = await held()
      const onDropped = vi.fn()
      expect(await sendHeldVoiceSnaps(store, failing(Object.assign(new Error('no'), { status })), onDropped)).toBe(0)
      expect(await store.all()).toEqual([])
      expect(onDropped).toHaveBeenCalledTimes(1)
      expect(onDropped).toHaveBeenCalledWith({ id: 'v-abcdefgh', caption: 'evening', status })
      expect(await sendHeldVoiceSnaps(store, failing(Object.assign(new Error('no'), { status })), onDropped)).toBe(0)
      expect(onDropped).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['the network', new Error('upload failed')],
      ['a server error', Object.assign(new Error('no'), { status: 503 })],
      ['a rate limit', Object.assign(new Error('no'), { status: 429 })],
    ])('keeps a held note after %s, to try again next visit', async (_what, err) => {
      const store = await held()
      const onDropped = vi.fn()
      expect(await sendHeldVoiceSnaps(store, failing(err), onDropped)).toBe(0)
      expect(await store.all()).toHaveLength(1)
      expect(onDropped).not.toHaveBeenCalled()
    })
  })

  it('reports the status of a refusal, so a held send can tell final from passing', async () => {
    fetchMock.mockResolvedValueOnce(ok({ snapId: 'v-abcdefgh', uploaded: true })).mockResolvedValueOnce(refused(400))
    await expect(sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })).rejects.toMatchObject({ status: 400 })
    fetchMock.mockResolvedValueOnce(refused(503))
    await expect(sendVoiceSnap(new Blob(['ab'], { type: 'audio/mp4' }), 4, 'v-abcdefgh', { caption: '' })).rejects.toMatchObject({ status: 503 })
  })
})
