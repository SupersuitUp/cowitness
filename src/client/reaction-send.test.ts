import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sendReaction, sendHeld, reactionKey, snapIdOfKey } from './reaction-send.js'
import { memoryVault, beginRecording, keepChunk, endRecording } from './recording-vault.js'

// Realistic vault-record-shaped ids: they matter here only in that they pass the server's
// validateCommentId shape (8-64 letters, digits, - or _), the same as a real vault record id.
const REC_A = 'r-4kx9m2p8'
const REC_B = 'r-9j2q7t1w'
const COMMENT_A = 'c-7f2a9d3e'

type Call = { url: string; method: string; body?: unknown }
let calls: Call[]
let putStatus: number

class FakeXHR {
  upload = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  private req = { method: '', url: '' }
  open(method: string, url: string) { this.req = { method, url } }
  setRequestHeader() {}
  send(body: unknown) { calls.push({ ...this.req, body }); setTimeout(() => { this.status = putStatus; this.onload?.() }, 0) }
}

beforeEach(() => {
  calls = []; putStatus = 200
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/upload-url')) return new Response(JSON.stringify({ commentId: COMMENT_A, url: `https://put/${COMMENT_A}`, requiredHeaders: { 'Content-Type': 'audio/mp4' } }))
    return new Response(JSON.stringify({ id: 's1', comments: [{ id: COMMENT_A, by: 'ana', text: '', at: 'now' }] }))
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('sending a reaction', () => {
  it('asks for a ticket, puts the bytes in storage, then files them under the snap', async () => {
    const comments = await sendReaction('s1', new Blob(['aac'], { type: 'audio/mp4' }), 12, COMMENT_A)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/us/snaps/s1/reactions/upload-url', `PUT https://put/${COMMENT_A}`, 'POST /api/us/snaps/s1/reactions',
    ])
    expect(calls[0].body).toEqual({ contentType: 'audio/mp4', size: 3, durationSec: 12, commentId: COMMENT_A })
    expect(calls[2].body).toEqual({ commentId: COMMENT_A, contentType: 'audio/mp4', durationSec: 12 })
    expect(comments).toEqual([{ id: COMMENT_A, by: 'ana', text: '', at: 'now' }])
  })

  it('a failed upload throws, so the caller keeps the recording', async () => {
    putStatus = 500
    await expect(sendReaction('s1', new Blob(['x'], { type: 'audio/webm' }), 3, COMMENT_A)).rejects.toThrow()
  })

  it('when the ticket says the bytes are already there, skips the PUT and files what is already stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/upload-url')) return new Response(JSON.stringify({ commentId: COMMENT_A, uploaded: true }))
      return new Response(JSON.stringify({ id: 's1', comments: [{ id: COMMENT_A, by: 'ana', text: '', at: 'now' }] }))
    }))
    const comments = await sendReaction('s1', new Blob(['aac'], { type: 'audio/mp4' }), 12, COMMENT_A)
    // No PUT at all: a second one against the same create-once object would only 412.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/us/snaps/s1/reactions/upload-url', 'POST /api/us/snaps/s1/reactions',
    ])
    expect(comments).toEqual([{ id: COMMENT_A, by: 'ana', text: '', at: 'now' }])
  })

  it('what the phone still holds is sent on the next visit and then let go', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: REC_A, noteId: reactionKey('s1'), mimeType: 'audio/mp4' })
    await keepChunk(store, REC_A, new Blob(['aac'], { type: 'audio/mp4' }), 4)
    await endRecording(store, REC_A, 4)
    await beginRecording(store, { id: 'n1', noteId: 'a-note', mimeType: 'audio/webm' })
    await keepChunk(store, 'n1', new Blob(['opus']), 2)
    await endRecording(store, 'n1', 2)
    const send = vi.fn(async () => [])
    expect(await sendHeld(store, send)).toBe(1)
    expect(send).toHaveBeenCalledWith('s1', expect.any(Blob), 4, REC_A)
    expect((await store.all()).map((r) => r.id)).toEqual(['n1'])
  })

  it('a held reaction that fails again stays held', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: REC_A, noteId: reactionKey('s1'), mimeType: 'audio/mp4' })
    await keepChunk(store, REC_A, new Blob(['aac']), 4)
    await endRecording(store, REC_A, 4)
    expect(await sendHeld(store, vi.fn(async () => { throw new Error('offline') }))).toBe(0)
    expect(await store.all()).toHaveLength(1)
  })

  it('a resend after the attach filed but the response was lost sends the SAME commentId', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: REC_A, noteId: reactionKey('s1'), mimeType: 'audio/mp4' })
    await keepChunk(store, REC_A, new Blob(['aac'], { type: 'audio/mp4' }), 4)
    await endRecording(store, REC_A, 4)

    // The first attempt's ticket and PUT succeed, but the attach's response never arrives
    // (a dropped connection right after the server filed it): sendReaction throws, so the
    // record stays held. The second attempt must ask for a ticket with the SAME id, because
    // that id is the only thing that lets the server's idempotency recognize the retry.
    let attachCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/upload-url')) return new Response(JSON.stringify({ url: 'https://put/x', requiredHeaders: { 'Content-Type': 'audio/mp4' } }))
      attachCalls += 1
      if (attachCalls === 1) throw new Error('connection dropped after the server filed it')
      return new Response(JSON.stringify({ id: 's1', comments: [] }))
    }))

    expect(await sendHeld(store)).toBe(0)
    expect(await store.all()).toHaveLength(1)
    expect(await sendHeld(store)).toBe(1)
    expect(await store.all()).toHaveLength(0)

    const ticketBodies = calls.filter((c) => c.url.endsWith('/upload-url')).map((c) => (c.body as { commentId: string }).commentId)
    const attachBodies = calls.filter((c) => c.url.endsWith('/reactions')).map((c) => (c.body as { commentId: string }).commentId)
    expect(ticketBodies).toEqual([REC_A, REC_A])
    expect(attachBodies).toEqual([REC_A, REC_A])
  })

  it('a resend whose earlier PUT already landed skips the PUT and the record is forgotten', async () => {
    const store = memoryVault()
    await beginRecording(store, { id: REC_B, noteId: reactionKey('s1'), mimeType: 'audio/mp4' })
    await keepChunk(store, REC_B, new Blob(['aac'], { type: 'audio/mp4' }), 4)
    await endRecording(store, REC_B, 4)

    // The bytes are already at this id's path (an earlier PUT succeeded; only its response was
    // lost), so the ticket says uploaded: true and there is nothing to PUT to.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/upload-url')) return new Response(JSON.stringify({ commentId: REC_B, uploaded: true }))
      return new Response(JSON.stringify({ id: 's1', comments: [{ id: REC_B, by: 'ana', text: '', at: 'now' }] }))
    }))

    expect(await sendHeld(store)).toBe(1)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/us/snaps/s1/reactions/upload-url', 'POST /api/us/snaps/s1/reactions',
    ])
    expect(await store.all()).toHaveLength(0)
  })

  it('keys round-trip, and a note id is not a snap', () => {
    expect(snapIdOfKey(reactionKey('s1'))).toBe('s1')
    expect(snapIdOfKey('n1')).toBeNull()
  })
})
