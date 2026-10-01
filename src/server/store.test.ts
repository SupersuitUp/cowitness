import { describe, expect, it, vi } from 'vitest'
import { createCowitnessStore } from './store.js'
import { fakeHost } from '../../test/support/fake-host.js'

const stored = (by: string, o: Record<string, unknown> = {}) => ({
  by, caption: '', kind: 'photo', takenAt: '2026-09-30T08:00:00', width: 3, height: 4,
  paths: { original: 'p/original/x.jpg', display: 'p/display/x.jpg', thumb: 'p/thumb/x.jpg' },
  witnessedAt: null, hiddenAt: null, createdAt: '2026-09-30T08:00:00.000Z', ...o,
})
function setup(opts: Parameters<typeof fakeHost>[0] = {}) {
  const { host, f, b } = fakeHost(opts)
  f.seed(host.collection, {
    x1: stored('ben', { createdAt: '2026-09-30T09:00:00.000Z' }),
    x2: stored('ana', { witnessedAt: '2026-09-30T10:00:00.000Z' }),
    x3: stored('ben', { hiddenAt: '2026-09-30T11:00:00.000Z' }),
  })
  return { host, f, b, store: createCowitnessStore(host) }
}
const AUDIO = 'p/snaps-audio/x1/r-abcdefgh.m4a'
const attach = { commentId: 'r-abcdefgh', contentType: 'audio/mp4', durationSec: 4 }

describe('filing a snap', () => {
  it("goes through the app's own pipeline, into the app's list, unwitnessed", async () => {
    const { host, f, store } = setup()
    const s = await store.finalizeSnapPhoto('ana', 'x9', { caption: ' lunch ' })
    expect(host.media.filePhoto).toHaveBeenCalledWith('ana', 'x9', undefined, expect.objectContaining({ ref: expect.objectContaining({ id: 'x9' }) }))
    expect(s).toMatchObject({ id: 'x9', by: 'ana', caption: 'lunch', witnessedAt: null, hiddenAt: null })
    expect(f.raw('snaps', 'x9')).toMatchObject({ by: 'ana', caption: 'lunch', kind: 'photo' })
  })

  it('refuses a caption over the cap before the upload is touched', async () => {
    const { host, store } = setup()
    await expect(store.finalizeSnapPhoto('ana', 'x9', { caption: 'x'.repeat(501) })).rejects.toMatchObject({ status: 400 })
    expect(host.media.filePhoto).not.toHaveBeenCalled()
  })

  it('files a video with the dimensions it was sent', async () => {
    const { store } = setup()
    const s = await store.finalizeSnapVideo('ben', 'v1', { meta: { durationSec: 3, width: 720, height: 1280 } })
    expect(s).toMatchObject({ kind: 'video', width: 720, height: 1280, by: 'ben' })
  })
})

describe('reading', () => {
  it('lists what this person can see, with signed media', async () => {
    const { store } = setup()
    const list = await store.listSnaps('ana')
    expect(list.map((s) => s.id).sort()).toEqual(['x1', 'x2'])
    expect(list[0].thumbUrl).toBe('signed:p/thumb/x.jpg')
  })

  it('gives the home its open tiles, its queue, its streak rows and the shelf count from one read', async () => {
    const { store } = setup()
    const home = await store.listCowitness('ana')
    expect(home.rows.map((r) => [r.id, r.thumbUrl])).toEqual([['x1', 'signed:p/thumb/x.jpg']])
    expect(home.queue.map((s) => s.id)).toEqual(['x1'])
    expect(home.streak.map((r) => r.id).sort()).toEqual(['x1', 'x2'])
    expect(home.streak.every((r) => r.thumbUrl === null)).toBe(true)
    expect(home.witnessed).toBe(1)
    expect((await store.listWitnessed('ana')).map((r) => r.id)).toEqual(['x2'])
    expect((await store.listQueue('ben')).map((s) => s.id)).toEqual([])
  })

  it('answers a snap hidden from this person exactly as a missing one', async () => {
    const { store } = setup()
    expect(await store.getSnapView('ana', 'x3')).toBeNull()
    expect(await store.getSnapView('ana', 'nope')).toBeNull()
    await expect(store.patchSnap('ana', 'x3', { kind: 'comment', text: 'hi' })).rejects.toMatchObject({ status: 404, message: 'snap not found' })
    expect(await store.getSnapView('ben', 'x3')).toMatchObject({ id: 'x3' })
  })

  it('counts the tile and signs the cover', async () => {
    const { store } = setup()
    expect(await store.cowitnessSummary('ana', '1970-01-01T00:00:00.000Z')).toEqual({ count: 2, coverUrl: 'signed:p/thumb/x.jpg', hasNew: true, waiting: 1 })
  })
})

describe('a spoken reaction', () => {
  it('goes up on a create-once signed PUT under the app prefix, or not at all if already there', async () => {
    const { b, store } = setup()
    const t = await store.reactionUploadUrl('ana', 'x1', { contentType: 'audio/mp4', size: 99, durationSec: 4, commentId: 'r-abcdefgh' })
    expect(t).toMatchObject({ commentId: 'r-abcdefgh', url: `https://signed.example/write/${AUDIO}` })
    expect(t).toMatchObject({ requiredHeaders: { 'Content-Type': 'audio/mp4', 'x-goog-if-generation-match': '0', 'x-goog-content-length-range': '0,41943040' } })
    b.put(AUDIO, Buffer.from('aa'))
    expect(await store.reactionUploadUrl('ana', 'x1', { contentType: 'audio/mp4', size: 99, durationSec: 4, commentId: 'r-abcdefgh' })).toEqual({ commentId: 'r-abcdefgh', uploaded: true })
    await expect(store.reactionUploadUrl('ana', 'x1', { contentType: 'audio/mp4', size: 99, durationSec: 4, commentId: 'short' })).rejects.toMatchObject({ status: 400 })
  })

  it('is filed once per id, transcribing, only after its bytes are stored', async () => {
    const { b, f, store } = setup()
    await expect(store.attachReaction('ana', 'x1', attach)).rejects.toMatchObject({ status: 404, message: 'that recording did not finish uploading' })
    b.put(AUDIO, Buffer.from('aa'))
    const first = await store.attachReaction('ana', 'x1', attach)
    expect(first.created).toBe(true)
    expect(first.snap.comments?.[0]).toMatchObject({ id: 'r-abcdefgh', by: 'ana', text: '', recording: { path: AUDIO, contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' } })
    expect((await store.attachReaction('ana', 'x1', attach)).created).toBe(false)
    expect(f.raw('snaps', 'x1')?.comments).toHaveLength(1)
    expect(await store.reactionAudioUrl('ben', 'x1', 'r-abcdefgh')).toBe(`signed:${AUDIO}`)
  })

  it("is written down by the app's transcriber, in the language asked for", async () => {
    const { host, b, store } = setup()
    b.put(AUDIO, Buffer.from('aa'))
    await store.attachReaction('ana', 'x1', attach)
    const done = await store.transcribeReaction('x1', 'r-abcdefgh')
    expect(host.transcription!.transcribe).toHaveBeenCalledWith(Buffer.from('aa'), 'audio/mp4', { language: 'auto', speaker: 'ana' })
    expect(done.comments?.[0]).toMatchObject({ text: 'hello there', recording: { path: AUDIO } })
    expect(done.comments?.[0].recording?.status).toBeUndefined()
  })

  it("Try again waits out a live job, then re-transcribes in the language asked for", async () => {
    const { host, b, f, store } = setup()
    b.put(AUDIO, Buffer.from('aa'))
    await store.attachReaction('ana', 'x1', attach)
    await expect(store.retranscribeReaction('ben', 'x1', 'r-abcdefgh', 'fr')).rejects.toMatchObject({ status: 409, message: 'this reaction is still being transcribed' })
    await store.transcribeReaction('x1', 'r-abcdefgh')
    const again = await store.retranscribeReaction('ben', 'x1', 'r-abcdefgh', 'fr')
    expect(host.transcription!.transcribe).toHaveBeenLastCalledWith(Buffer.from('aa'), 'audio/mp4', { language: 'fr', speaker: 'ana' })
    expect(again.comments?.[0].recording?.language).toBe('fr')
    expect(f.raw('snaps', 'x1')?.comments).toHaveLength(1)
  })

  it("keeps the transcriber's own refusal words, and says something plain for anything else", async () => {
    class HostError extends Error { constructor(m: string, public status: number) { super(m) } }
    const transcribe = vi.fn()
      .mockRejectedValueOnce(new HostError('that recording is too long for the transcriber to take in one piece', 400))
      .mockRejectedValueOnce(new Error('socket hang up'))
    const { b, store } = setup({ transcription: { languages: ['en'], transcribe }, isRefusal: (e) => e instanceof HostError })
    b.put(AUDIO, Buffer.from('aa'))
    await store.attachReaction('ana', 'x1', attach)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = await store.transcribeReaction('x1', 'r-abcdefgh')
    expect(first.comments?.[0].recording).toMatchObject({ status: 'failed', reason: 'that recording is too long for the transcriber to take in one piece' })
    const second = await store.retranscribeReaction('ana', 'x1', 'r-abcdefgh')
    expect(second.comments?.[0].recording).toMatchObject({ status: 'failed', reason: 'the recording could not be made out' })
    spy.mockRestore()
  })

  it("shows a client only the host's own refusals: a status on a foreign error is not enough", async () => {
    class ClientError extends Error { constructor(m: string, public status: number) { super(m) } }
    const transcribe = vi.fn().mockRejectedValue(new ClientError('bucket my-private-bucket denied', 403))
    const { b, store } = setup({ transcription: { languages: ['en'], transcribe } })
    b.put(AUDIO, Buffer.from('aa'))
    await store.attachReaction('ana', 'x1', attach)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const done = await store.transcribeReaction('x1', 'r-abcdefgh')
    expect(done.comments?.[0].recording).toMatchObject({ status: 'failed', reason: 'the recording could not be made out' })
    spy.mockRestore()
  })

  it('in an app with no transcriber, is filed playable with no words, and Try again says so', async () => {
    const { b, store } = setup({ transcription: null })
    b.put(AUDIO, Buffer.from('aa'))
    const { snap } = await store.attachReaction('ana', 'x1', attach)
    expect(snap.comments?.[0].recording).toEqual({ path: AUDIO, contentType: 'audio/mp4', durationSec: 4 })
    await expect(store.retranscribeReaction('ana', 'x1', 'r-abcdefgh')).rejects.toMatchObject({ status: 404, message: 'transcription is not available' })
    await expect(store.transcribeReaction('x1', 'r-abcdefgh')).rejects.toMatchObject({ status: 404 })
  })
})

describe('stored data', () => {
  it('keeps a field this version does not know when a record is written back', async () => {
    const { f, store } = setup()
    f.seed('snaps', { y1: stored('ben', { futureField: { nested: [1, 2] }, comments: [{ id: 'c1', by: 'ben', text: 'hi', at: '2026-09-30T09:30:00.000Z', futureComment: 'kept' }] }) })
    await store.patchSnap('ana', 'y1', { kind: 'comment', text: 'hello' })
    const raw = f.raw('snaps', 'y1')!
    expect(raw.futureField).toEqual({ nested: [1, 2] })
    expect(raw.comments).toHaveLength(2)
    expect((raw.comments as Array<Record<string, unknown>>)[0].futureComment).toBe('kept')
    expect(raw).toMatchObject({ by: 'ben', paths: { thumb: 'p/thumb/x.jpg' }, witnessedAt: null, hiddenAt: null })
  })
})
