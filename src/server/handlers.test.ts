import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuleError } from '../errors.js'
import { createCowitnessHandlers } from './handlers.js'
import type { CowitnessHost } from './host.js'
import type { CowitnessStore } from './store.js'

const { scheduled } = vi.hoisted(() => ({ scheduled: [] as Promise<unknown>[] }))
// after() runs once the response has gone; here it runs at once so the test can see it.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { scheduled.push(fn()) } }))

type M = 'ana' | 'ben'
// An error the app owns; the app says so through its host, and only then do its words reach a client.
class HostError extends Error { constructor(m: string, public status: number) { super(m) } }
const requireMember = vi.fn<() => Promise<M | null>>()
const store = {
  listSnaps: vi.fn(), finalizeSnapPhoto: vi.fn(), finalizeSnapVideo: vi.fn(), getSnapView: vi.fn(), patchSnap: vi.fn(),
  reactionUploadUrl: vi.fn(), attachReaction: vi.fn(), reactionAudioUrl: vi.fn(),
  transcribeReaction: vi.fn(async () => ({})), retranscribeReaction: vi.fn(),
}
const announce = { shared: vi.fn(), witnessed: vi.fn(), message: vi.fn(), heart: vi.fn() }
const commentImages = { claim: vi.fn(async (_m: M, p: unknown) => p), attach: vi.fn(async () => {}) }
const host = {
  member: () => requireMember(), announce, commentImages,
  transcription: { languages: ['en', 'fr'], transcribe: vi.fn() },
  isRefusal: (e: unknown) => e instanceof HostError,
} as unknown as CowitnessHost<M>
const h = createCowitnessHandlers(host, store as unknown as CowitnessStore<M>)
const mocked = vi.mocked(store)

const listGET = h.snaps.GET
const photoPOST = h.photo.POST
const videoPOST = h.video.POST
const oneGET = h.snap.GET
const onePATCH = h.snap.PATCH
const ticketPOST = h.reactionUploadUrl.POST
const attachPOST = h.reactions.POST
const retryPOST = h.reactionTranscribe.POST
const audioGET = h.reactionAudio.GET

const json = (method: string, body?: unknown) => new Request('https://x/api/snaps', {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const post = (body: unknown) => new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = Promise.resolve({ id: 's1' })

describe('the snaps API', () => {
  beforeEach(() => { vi.clearAllMocks(); requireMember.mockResolvedValue('ben') })

  it('403s a stranger before any store call, on every route', async () => {
    requireMember.mockResolvedValue(null)
    expect((await listGET()).status).toBe(403)
    expect((await photoPOST(json('POST', { photoId: 'p1' }))).status).toBe(403)
    expect((await onePATCH(json('PATCH', { kind: 'hide' }), { params })).status).toBe(403)
    expect(mocked.listSnaps).not.toHaveBeenCalled()
    expect(mocked.finalizeSnapPhoto).not.toHaveBeenCalled()
    expect(mocked.patchSnap).not.toHaveBeenCalled()
  })

  it('lists the archive for the signed-in member', async () => {
    mocked.listSnaps.mockResolvedValue([{ id: 's1' }] as never)
    const res = await listGET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([{ id: 's1' }])
    expect(mocked.listSnaps).toHaveBeenCalledWith('ben')
  })

  it('files a photo snap and tells the app it was shared', async () => {
    mocked.finalizeSnapPhoto.mockResolvedValue({ id: 'p1', by: 'ben', kind: 'photo' } as never)
    const res = await photoPOST(json('POST', { photoId: 'p1', caption: 'lunch' }))
    expect(res.status).toBe(200)
    expect(mocked.finalizeSnapPhoto).toHaveBeenCalledWith('ben', 'p1', { caption: 'lunch', clientTakenAt: undefined })
    expect(announce.shared).toHaveBeenCalledWith('ben', expect.objectContaining({ id: 'p1' }))
  })

  it('files a video snap with validated meta, and 400s bad meta before the store', async () => {
    mocked.finalizeSnapVideo.mockResolvedValue({ id: 'v1', by: 'ben', kind: 'video' } as never)
    const res = await videoPOST(json('POST', { photoId: 'v1', durationSec: 3, width: 720, height: 1280 }))
    expect(res.status).toBe(200)
    expect(mocked.finalizeSnapVideo).toHaveBeenCalledWith('ben', 'v1', { caption: undefined, meta: { durationSec: 3, width: 720, height: 1280, takenAt: undefined } })
    expect(announce.shared).toHaveBeenCalledWith('ben', expect.objectContaining({ id: 'v1' }))
    vi.clearAllMocks()
    requireMember.mockResolvedValue('ben')
    expect((await videoPOST(json('POST', { photoId: 'v1', durationSec: -1, width: 720, height: 1280 }))).status).toBe(400)
    expect(mocked.finalizeSnapVideo).not.toHaveBeenCalled()
  })

  it('answers one snap, or 404 when it is hidden from the caller or gone', async () => {
    mocked.getSnapView.mockResolvedValueOnce({ id: 's1' } as never).mockResolvedValueOnce(null)
    expect((await oneGET(json('GET'), { params })).status).toBe(200)
    const gone = await oneGET(json('GET'), { params })
    expect(gone.status).toBe(404)
    await expect(gone.json()).resolves.toEqual({ error: 'not found' })
  })

  it('patches with one stamp shared by the store and the announcement, through the app\'s pictures', async () => {
    mocked.patchSnap.mockResolvedValue({ id: 's1', comments: [{ id: 'c1', by: 'ben', text: 'lovely', at: 'x' }] } as never)
    const res = await onePATCH(json('PATCH', { kind: 'comment', text: 'lovely' }), { params })
    expect(res.status).toBe(200)
    expect(mocked.patchSnap).toHaveBeenCalledWith('ben', 's1', { kind: 'comment', text: 'lovely' }, { now: expect.any(String) })
    expect(commentImages.claim).toHaveBeenCalledWith('ben', { kind: 'comment', text: 'lovely' })
    expect(commentImages.attach).toHaveBeenCalledWith({ kind: 'comment', text: 'lovely' }, { collection: 'snaps', id: 's1' }, [expect.objectContaining({ id: 'c1' })])
    expect(announce.message).toHaveBeenCalledWith('ben', expect.objectContaining({ id: 's1' }), expect.objectContaining({ id: 'c1' }))
  })

  it('a witness that set the stamp tells the person who shared it, with the typed words', async () => {
    mocked.patchSnap.mockImplementation(async (_m: unknown, _id: unknown, _p: unknown, opts?: { now?: string }) => ({ id: 's1', witnessedAt: opts?.now, comments: [] }) as never)
    await onePATCH(json('PATCH', { kind: 'witness', text: ' so good ' }), { params })
    expect(announce.witnessed).toHaveBeenCalledWith('ben', expect.objectContaining({ id: 's1' }), 'so good')
  })

  it('hiding is never news', async () => {
    mocked.patchSnap.mockResolvedValue({ id: 's1', hiddenAt: 'x', comments: [] } as never)
    await onePATCH(json('PATCH', { kind: 'hide' }), { params })
    for (const f of Object.values(announce)) expect(f).not.toHaveBeenCalled()
  })

  it('maps a store refusal to its status', async () => {
    mocked.patchSnap.mockRejectedValue(new RuleError('only the member who shared it can hide it', 403))
    const res = await onePATCH(json('PATCH', { kind: 'hide' }), { params })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'only the member who shared it can hide it' })
  })

  it("passes the app's own upload refusal through word for word, which the phone's retry relies on", async () => {
    mocked.finalizeSnapPhoto.mockRejectedValue(new HostError('upload not found or expired', 400))
    const res = await photoPOST(json('POST', { photoId: 'p1' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'upload not found or expired' })
  })
})

describe('the reactions API', () => {
  beforeEach(() => { vi.clearAllMocks(); requireMember.mockResolvedValue('ana'); scheduled.length = 0 })

  it("issues a create-once upload for the signed-in member, with the client's own id", async () => {
    mocked.reactionUploadUrl.mockResolvedValue({ commentId: 'c9', url: 'https://put', requiredHeaders: { 'Content-Type': 'audio/mp4' } } as never)
    const res = await ticketPOST(post({ contentType: 'audio/mp4', size: 99, durationSec: 12, commentId: 'c9' }), { params })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ commentId: 'c9', url: 'https://put', requiredHeaders: { 'Content-Type': 'audio/mp4' } })
    expect(mocked.reactionUploadUrl).toHaveBeenCalledWith('ana', 's1', { contentType: 'audio/mp4', size: 99, durationSec: 12, commentId: 'c9' })
  })

  it('files the uploaded recording as a message and answers the snap', async () => {
    mocked.attachReaction.mockResolvedValue({ snap: { id: 's1', comments: [{ id: 'reaction9' }] }, created: true } as never)
    const res = await attachPOST(post({ commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 }), { params })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 's1', comments: [{ id: 'reaction9' }] })
    expect(mocked.attachReaction).toHaveBeenCalledWith('ana', 's1', { commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 })
  })

  it('answers the filing at once, then transcribes it after the response', async () => {
    mocked.attachReaction.mockResolvedValue({ snap: { id: 's1', comments: [{ id: 'reaction9', recording: { status: 'transcribing' } }] }, created: true } as never)
    const res = await attachPOST(post({ commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 }), { params })
    expect(res.status).toBe(200)
    await Promise.all(scheduled)
    expect(mocked.transcribeReaction).toHaveBeenCalledWith('s1', 'reaction9')
  })

  it('an idempotent re-attach of a reaction already filed schedules no second transcription', async () => {
    mocked.attachReaction.mockResolvedValue({ snap: { id: 's1', comments: [{ id: 'reaction9' }] }, created: false } as never)
    const res = await attachPOST(post({ commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 }), { params })
    expect(res.status).toBe(200)
    expect(scheduled).toHaveLength(0)
    expect(mocked.transcribeReaction).not.toHaveBeenCalled()
  })

  it('an app with no transcriber files the reaction and schedules nothing', async () => {
    const quiet = createCowitnessHandlers({ ...host, transcription: undefined } as CowitnessHost<M>, store as unknown as CowitnessStore<M>)
    mocked.attachReaction.mockResolvedValue({ snap: { id: 's1', comments: [] }, created: true } as never)
    expect((await quiet.reactions.POST(post({ commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 }), { params })).status).toBe(200)
    expect(scheduled).toHaveLength(0)
  })

  it('a transcription that throws after the response is logged, never surfaced', async () => {
    mocked.attachReaction.mockResolvedValue({ snap: { id: 's1', comments: [] }, created: true } as never)
    mocked.transcribeReaction.mockRejectedValue(new Error('model down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await attachPOST(post({ commentId: 'reaction9', contentType: 'audio/mp4', durationSec: 12 }), { params })
    expect(res.status).toBe(200)
    expect(scheduled).toHaveLength(1)
    await expect(Promise.all(scheduled)).resolves.toBeDefined()
    expect(mocked.transcribeReaction).toHaveBeenCalledWith('s1', 'reaction9')
    expect(spy).toHaveBeenCalledWith('reaction transcription failed', expect.any(Error))
    spy.mockRestore()
  })

  it('Try again transcribes on request, in the language asked for', async () => {
    mocked.retranscribeReaction.mockResolvedValue({ id: 's1' } as never)
    const res = await retryPOST(post({ language: 'fr' }), { params: Promise.resolve({ id: 's1', commentId: 'c9' }) })
    expect(res.status).toBe(200)
    expect(mocked.retranscribeReaction).toHaveBeenCalledWith('ana', 's1', 'c9', 'fr')
  })

  it("passes the store's refusals through with their words", async () => {
    mocked.reactionUploadUrl.mockRejectedValue(new RuleError('a reaction is at most three minutes', 400))
    const res = await ticketPOST(post({ contentType: 'audio/mp4', size: 99, durationSec: 999 }), { params })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'a reaction is at most three minutes' })
  })

  it('a malformed commentId reaching upload-url answers 400, not a signed URL', async () => {
    // The route itself does no shape-checking (it forwards the body whole); validateCommentId
    // lives in the store, so this pins the route's error-handling for exactly that refusal.
    mocked.reactionUploadUrl.mockRejectedValue(new RuleError('commentId must be 8 to 64 letters, numbers, - or _', 400))
    const res = await ticketPOST(post({ contentType: 'audio/mp4', size: 99, durationSec: 12, commentId: 'short' }), { params })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'commentId must be 8 to 64 letters, numbers, - or _' })
    expect(mocked.reactionUploadUrl).toHaveBeenCalledWith('ana', 's1', { contentType: 'audio/mp4', size: 99, durationSec: 12, commentId: 'short' })
  })

  it('plays a recording through a short-lived redirect, never a public URL', async () => {
    mocked.reactionAudioUrl.mockResolvedValue('https://signed/audio')
    const res = await audioGET(new Request('https://x'), { params: Promise.resolve({ id: 's1', commentId: 'c9' }) })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://signed/audio')
  })

  it('403s a stranger on every route', async () => {
    requireMember.mockResolvedValue(null)
    expect((await ticketPOST(post({}), { params })).status).toBe(403)
    expect((await attachPOST(post({}), { params })).status).toBe(403)
    expect((await audioGET(new Request('https://x'), { params: Promise.resolve({ id: 's1', commentId: 'c9' }) })).status).toBe(403)
    expect((await retryPOST(post({}), { params: Promise.resolve({ id: 's1', commentId: 'c9' }) })).status).toBe(403)
  })
})

describe('a host that says which of its own errors are refusals (the main host above supplies the hook)', () => {
  const withHook = h
  beforeEach(() => { vi.clearAllMocks(); requireMember.mockResolvedValue('ben') })

  it("the host's own refusal reaches the client with its words and status", async () => {
    mocked.finalizeSnapPhoto.mockRejectedValue(new HostError('upload not found or expired', 400))
    const res = await withHook.photo.POST(json('POST', { photoId: 'p1' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'upload not found or expired' })
  })

  it("the package's own refusal still reaches the client when the host supplies a hook", async () => {
    mocked.patchSnap.mockRejectedValue(new RuleError('only the member who shared it can hide it', 403))
    const res = await withHook.snap.PATCH(json('PATCH', { kind: 'hide' }), { params })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'only the member who shared it can hide it' })
  })

  it('a host with no hook still passes the package\'s own refusals, and nothing else', async () => {
    const bare = createCowitnessHandlers({ ...host, isRefusal: undefined } as CowitnessHost<M>, store as unknown as CowitnessStore<M>)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocked.patchSnap.mockRejectedValue(new RuleError('only the member who shared it can hide it', 403))
    expect((await bare.snap.PATCH(json('PATCH', { kind: 'hide' }), { params })).status).toBe(403)
    mocked.finalizeSnapPhoto.mockRejectedValue(new HostError('upload not found or expired', 400))
    expect((await bare.photo.POST(json('POST', { photoId: 'p1' }))).status).toBe(500)
    spy.mockRestore()
  })

  it('an error the host does not claim stays an opaque 500, whatever status it carries', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocked.finalizeSnapPhoto.mockRejectedValue(Object.assign(new Error('bucket secret-name not found'), { status: 404 }))
    const res = await withHook.photo.POST(json('POST', { photoId: 'p1' }))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'something went wrong' })
    spy.mockRestore()
  })
})
