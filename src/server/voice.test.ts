// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const { scheduled } = vi.hoisted(() => ({ scheduled: [] as Promise<unknown>[] }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { scheduled.push(fn()) } }))
import { createCowitnessStore } from './store.js'
import { createCowitnessHandlers } from './handlers.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { CowitnessHost } from './host.js'
import type { Person } from '../features.js'
import { CLIP_MAX_BYTES } from '../shared-rules.js'

const PATH = 'p/snaps-voice/v-abcdefgh.m4a'
const body = { snapId: 'v-abcdefgh', contentType: 'audio/mp4', durationSec: 9 }
// The bytes as a signed PUT leaves them: the uploader is the object's own metadata, set by the
// header the signed URL required.
type Bucket = ReturnType<typeof fakeHost>['b']
const upload = (b: Bucket, by: M = 'ana', path = PATH, bytes = Buffer.from('abcd'), ct = 'audio/mp4') => b.put(path, bytes, ct, { 'cowitness-by': by })
function setup(on = true) {
  const { host, f, b } = fakeHost({ features: on ? { voiceSnaps: true } : {} })
  const store = createCowitnessStore(host)
  vi.mocked(host.member).mockResolvedValue('ana')
  return { host, f, b, store, routes: createCowitnessHandlers(host, store) }
}
const post = (x: unknown) => new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x) })
const get = () => new Request('https://x')
const id = (x: string) => ({ params: Promise.resolve({ id: x }) })
const as = (host: CowitnessHost<M>, m: M) => vi.mocked(host.member).mockResolvedValue(m)

describe('voice snaps', () => {
  it('signs a create-once upload, or says the bytes are already there', async () => {
    const { store, b } = setup()
    expect(await store.voiceUploadUrl('ana', { ...body, size: 4 })).toMatchObject({ snapId: 'v-abcdefgh', url: `https://signed.example/write/${PATH}` })
    upload(b)
    expect(await store.voiceUploadUrl('ana', { ...body, size: 4 })).toEqual({ snapId: 'v-abcdefgh', uploaded: true })
  })
  it('files once per id, announces once, and writes the words in afterwards', async () => {
    const { routes, b, f, host } = setup()
    upload(b)
    const first = await routes.voice.POST(post({ ...body, caption: ' evening ', language: 'fr' }))
    expect(first.status).toBe(200)
    await Promise.all(scheduled.splice(0))
    expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ kind: 'voice', caption: 'evening', voice: { text: 'hello there', path: PATH } })
    expect((await routes.voice.POST(post(body))).status).toBe(200)
    expect(host.announce.shared).toHaveBeenCalledTimes(1)
  })
  it('refuses an id another person already filed, a missing upload, and everything where voice notes are off', async () => {
    const { routes, b, host } = setup()
    expect((await routes.voice.POST(post(body))).status).toBe(404)
    upload(b)
    expect((await routes.voice.POST(post(body))).status).toBe(200)
    as(host, 'ben')
    expect((await routes.voice.POST(post(body))).status).toBe(409)
    expect(host.announce.shared).toHaveBeenCalledTimes(1)
    const off = setup(false)
    upload(off.b)
    expect((await off.routes.voice.POST(post(body))).status).toBe(404)
    expect((await off.routes.voiceUploadUrl.POST(post({ ...body, size: 4 }))).status).toBe(404)
    expect(off.f.raw('snaps', 'v-abcdefgh')).toBeUndefined()
  })
  it('plays from a signed link, never through the app\'s photo pipeline', async () => {
    const { routes, store, b, host } = setup()
    upload(b)
    await routes.voice.POST(post(body))
    const view = await store.getSnapView('ana', 'v-abcdefgh')
    expect(view).toMatchObject({ thumbUrl: null, displayUrl: null, audioUrl: `signed:${PATH}` })
    expect(host.media.urls).not.toHaveBeenCalled()
  })
  it('transcribes again on request, and refuses while a live run is going', async () => {
    // The first run is held open until the test lets it finish, so "live" is a fact, not a race.
    let finish!: () => void
    const held = new Promise<void>((r) => { finish = r })
    const transcribe = vi.fn(async () => { await held; return 'hello there' })
    const { host, b } = fakeHost({ features: { voiceSnaps: true }, transcription: { languages: ['en', 'fr'], transcribe } })
    const store = createCowitnessStore(host)
    const routes = createCowitnessHandlers(host, store)
    upload(b)
    await routes.voice.POST(post(body))
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    await expect(store.retranscribeVoiceSnap('ana', 'v-abcdefgh', 'fr')).rejects.toMatchObject({ status: 409 })
    expect((await routes.voiceTranscribe.POST(post({ language: 'fr' }), id('v-abcdefgh'))).status).toBe(409)
    finish()
    await Promise.all(scheduled.splice(0))
    const again = await store.retranscribeVoiceSnap('ana', 'v-abcdefgh', 'fr')
    expect(again.voice).toMatchObject({ text: 'hello there', language: 'fr' })
    expect(again.voice).not.toHaveProperty('status')
  })
})

describe('a voice snap filed with tags', () => {
  it('is announced as tagged, after it is announced as shared', async () => {
    const { host, f, b } = fakeHost({ features: { voiceSnaps: true, tags: true } })
    const tagged = vi.fn()
    const h: CowitnessHost<M> = { ...host, tags: { list: async () => [{ id: 't-first', label: 'First' }] }, announce: { ...host.announce, tagged } }
    const routes = createCowitnessHandlers(h, createCowitnessStore(h))
    upload(b)
    expect((await routes.voice.POST(post({ ...body, tags: ['t-first'] }))).status).toBe(200)
    expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ tags: ['t-first'] })
    expect(tagged).toHaveBeenCalledWith('ana', expect.objectContaining({ id: 'v-abcdefgh' }), ['t-first'])
    expect(vi.mocked(h.announce.shared).mock.invocationCallOrder[0]).toBeLessThan(tagged.mock.invocationCallOrder[0])
    upload(b, 'ana', 'p/snaps-voice/v-untagged0.m4a')
    await routes.voice.POST(post({ ...body, snapId: 'v-untagged0' }))
    expect(tagged).toHaveBeenCalledTimes(1)
    expect((await routes.voice.POST(post({ ...body, snapId: 'v-badtag00', tags: ['nope'] }))).status).toBe(400)
  })
})

// ana and ben share; cy witnesses.
const CIRCLE: Person<M>[] = [{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'shares' }, { key: 'cy', role: 'witnesses' }]
function audience(features: CowitnessHost<M>['features'] = { voiceSnaps: true, witnessing: 'audience', justUs: true }) {
  const { host, f, b } = fakeHost({ features })
  const h: CowitnessHost<M> = { ...host, people: async () => CIRCLE }
  const store = createCowitnessStore(h)
  vi.mocked(h.member).mockResolvedValue('ana')
  return { host: h, f, b, store, routes: createCowitnessHandlers(h, store) }
}

describe('a "just us" voice snap', () => {
  it('reaches nobody outside the people who share: lists, cover, counts, audio, words, announcements', async () => {
    const { host, b, store, routes, f } = audience()
    upload(b)
    expect((await routes.voice.POST(post({ ...body, justUs: true }))).status).toBe(200)
    await Promise.all(scheduled.splice(0))
    expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ justUs: true, voice: { text: 'hello there' } })
    // The announcement carries the flag the app filters its recipients by.
    expect(host.announce.shared).toHaveBeenCalledWith('ana', expect.objectContaining({ id: 'v-abcdefgh', justUs: true }))

    // ben shares, so he hears it; cy only witnesses, so it does not exist for him.
    expect((await store.getSnapView('ben', 'v-abcdefgh'))?.audioUrl).toBe(`signed:${PATH}`)
    vi.mocked(host.media.signedUrl).mockClear()
    expect(await store.getSnapView('cy', 'v-abcdefgh')).toBeNull()
    expect((await store.listSnaps('cy')).map((s) => s.id)).toEqual([])
    expect((await store.listQueue('cy')).map((s) => s.id)).toEqual([])
    const home = await store.listCowitness('cy')
    expect([home.rows, home.queue, home.streak].map((x) => x.length)).toEqual([0, 0, 0])
    expect(home.witnessed).toBe(0)
    expect(await store.cowitnessSummary('cy', '2000-01-01T00:00:00.000Z')).toEqual({ count: 0, coverUrl: null, hasNew: false, waiting: 0 })
    expect(host.media.signedUrl).not.toHaveBeenCalled()
    as(host, 'cy')
    expect((await routes.snap.GET(get(), id('v-abcdefgh'))).status).toBe(404)
    expect((await routes.voiceTranscribe.POST(post({}), id('v-abcdefgh'))).status).toBe(404)
    await expect(store.retranscribeVoiceSnap('cy', 'v-abcdefgh')).rejects.toMatchObject({ status: 404 })
    expect(host.transcription!.transcribe).toHaveBeenCalledTimes(1)
  })
  it('counts for the people who share, and is never a cover, having no picture', async () => {
    const { b, store, routes } = audience()
    upload(b)
    await routes.voice.POST(post({ ...body, justUs: true }))
    const tile = await store.cowitnessSummary('ben', '2000-01-01T00:00:00.000Z')
    expect(tile).toMatchObject({ count: 1, coverUrl: null, hasNew: true })
    const home = await store.listCowitness('ben')
    expect(home.rows).toEqual([expect.objectContaining({ id: 'v-abcdefgh', kind: 'voice', thumbUrl: null, justUs: true, durationSec: 9 })])
  })
  it('stays its author\'s alone once no circle can say who shares', async () => {
    const on = audience({ voiceSnaps: true, justUs: true })
    upload(on.b)
    await on.routes.voice.POST(post({ ...body, justUs: true }))
    // The same records, read by an app that has since turned "just us" off.
    const { host } = fakeHost({ features: { voiceSnaps: true } })
    const later = createCowitnessStore({ ...host, db: on.host.db, storage: on.host.storage })
    expect(await later.getSnapView('ben', 'v-abcdefgh')).toBeNull()
    expect(await later.listSnaps('ben')).toEqual([])
    expect((await later.getSnapView('ana', 'v-abcdefgh'))?.audioUrl).toBe(`signed:${PATH}`)
    await expect(later.retranscribeVoiceSnap('ben', 'v-abcdefgh')).rejects.toMatchObject({ status: 404 })
  })
  it('is refused to someone who does not share, and the witness cannot file a voice snap at all', async () => {
    const { host, b, routes, f } = audience()
    as(host, 'cy')
    upload(b, 'cy')
    expect((await routes.voiceUploadUrl.POST(post({ ...body, size: 4 }))).status).toBe(403)
    expect((await routes.voice.POST(post({ ...body, justUs: true }))).status).toBe(403)
    expect(f.raw('snaps', 'v-abcdefgh')).toBeUndefined()
    // "just us" with the option off is refused like any other option's field.
    const plain = setup()
    upload(plain.b)
    expect((await plain.routes.voice.POST(post({ ...body, justUs: true }))).status).toBe(400)
  })
})

describe('the voice upload pipeline', () => {
  it('signs only a create-once PUT, capped at the clip ceiling, that stamps who uploaded it', async () => {
    const { store } = setup()
    const t = await store.voiceUploadUrl('ana', { ...body, size: 4 })
    expect(t).toMatchObject({ requiredHeaders: {
      'Content-Type': 'audio/mp4', 'x-goog-if-generation-match': '0',
      'x-goog-content-length-range': `0,${CLIP_MAX_BYTES}`, 'x-goog-meta-cowitness-by': 'ana',
    } })
  })
  it('refuses a type that is not audio, a size over the ceiling, a recording too long, and a bad id', async () => {
    const { routes } = setup()
    const ask = (x: object) => routes.voiceUploadUrl.POST(post({ ...body, size: 4, ...x }))
    expect((await ask({ contentType: 'video/mp4' })).status).toBe(400)
    expect((await ask({ size: CLIP_MAX_BYTES + 1 })).status).toBe(400)
    expect((await ask({ size: 0 })).status).toBe(400)
    expect((await ask({ durationSec: 1300 })).status).toBe(400)
    expect((await ask({ snapId: '../../x' })).status).toBe(400)
  })
  it('measures the bytes that actually arrived, not the size the phone claimed', async () => {
    const { routes, b, f } = setup()
    upload(b, 'ana', PATH, Buffer.alloc(CLIP_MAX_BYTES + 1))
    expect((await routes.voice.POST(post(body))).status).toBe(400)
    upload(b, 'ana', PATH, Buffer.alloc(0))
    expect((await routes.voice.POST(post(body))).status).toBe(400)
    expect((await routes.voice.POST(post({ ...body, contentType: 'text/plain' }))).status).toBe(400)
    expect(f.raw('snaps', 'v-abcdefgh')).toBeUndefined()
  })
  it('refuses a foreign ticket: bytes someone else uploaded, or bytes nobody signed for', async () => {
    const { host, routes, b, f } = setup()
    upload(b, 'ben')
    expect((await routes.voice.POST(post(body))).status).toBe(403)
    expect((await routes.voiceUploadUrl.POST(post({ ...body, size: 4 }))).status).toBe(403)
    b.put(PATH, Buffer.from('abcd'), 'audio/mp4')
    expect((await routes.voice.POST(post(body))).status).toBe(403)
    expect(f.raw('snaps', 'v-abcdefgh')).toBeUndefined()
    expect(host.announce.shared).not.toHaveBeenCalled()
  })
  it('refuses a replay: a filed id is never signed again, never refiled, never taken over', async () => {
    const { host, routes, store, b, f } = setup()
    upload(b)
    await routes.voice.POST(post({ ...body, caption: 'first' }))
    await Promise.all(scheduled.splice(0))
    // A filed id is never signed again, even for its author.
    await expect(store.voiceUploadUrl('ana', { ...body, size: 4 })).rejects.toMatchObject({ status: 409 })
    // Filing it again returns the snap as it is: no second record, announcement or transcription.
    const again = await (await routes.voice.POST(post({ ...body, caption: 'second' }))).json()
    expect(again).toMatchObject({ caption: 'first' })
    expect(scheduled).toHaveLength(0)
    expect(host.announce.shared).toHaveBeenCalledTimes(1)
    expect(host.transcription!.transcribe).toHaveBeenCalledTimes(1)
    expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ caption: 'first' })
  })
  it('never files a voice note over a photo snap that has the same id', async () => {
    const { host, routes, b, f } = setup()
    await routes.photo.POST(post({ photoId: 'v-abcdefgh' }))
    upload(b)
    expect((await routes.voice.POST(post(body))).status).toBe(409)
    expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ kind: 'photo' })
    expect(host.announce.shared).toHaveBeenCalledTimes(1)
  })
})

describe('one id, one recording', () => {
  it('signs nothing for an id that is already a snap, whoever asks', async () => {
    const { host, routes, b } = setup()
    upload(b)
    await routes.voice.POST(post(body))
    expect((await routes.voiceUploadUrl.POST(post({ ...body, size: 4 }))).status).toBe(409)
    as(host, 'ben')
    expect((await routes.voiceUploadUrl.POST(post({ ...body, contentType: 'audio/webm', size: 4 }))).status).toBe(409)
    await routes.photo.POST(post({ photoId: 'p-photo0001' }))
    expect((await routes.voiceUploadUrl.POST(post({ ...body, snapId: 'p-photo0001', size: 4 }))).status).toBe(409)
  })
  it('fixes an id\'s type at its first upload: another type is never signed or filed for it', async () => {
    const { routes, b, f } = setup()
    upload(b)
    expect((await routes.voiceUploadUrl.POST(post({ ...body, contentType: 'audio/webm', size: 4 }))).status).toBe(409)
    expect((await routes.voice.POST(post({ ...body, contentType: 'audio/webm' }))).status).toBe(409)
    expect(f.raw('snaps', 'v-abcdefgh')).toBeUndefined()
    expect((await routes.voice.POST(post(body))).status).toBe(200)
  })
})

describe('who may transcribe a voice snap again', () => {
  const NOW = new Date('2026-09-30T12:00:00.000Z')
  const later = (min: number) => new Date(NOW.getTime() + min * 60_000)
  it('lets its author redo settled words; anyone else only a failed or stalled run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const transcribe = vi.fn(async () => 'hello there')
      const { host, b } = fakeHost({ features: { voiceSnaps: true }, transcription: { languages: ['en', 'fr'], transcribe } })
      const store = createCowitnessStore(host)
      const routes = createCowitnessHandlers(host, store)
      upload(b)
      await routes.voice.POST(post(body))
      await Promise.all(scheduled.splice(0))
      // Settled words: the author may hear them again in another language, nobody else may.
      await expect(store.retranscribeVoiceSnap('ben', 'v-abcdefgh', 'fr')).rejects.toMatchObject({ status: 403 })
      as(host, 'ben')
      expect((await routes.voiceTranscribe.POST(post({ language: 'fr' }), id('v-abcdefgh'))).status).toBe(403)
      expect((await store.retranscribeVoiceSnap('ana', 'v-abcdefgh', 'fr')).voice).toMatchObject({ language: 'fr', text: 'hello there' })
      // A failed run is anyone's to try again.
      transcribe.mockRejectedValueOnce(new Error('down'))
      expect((await store.retranscribeVoiceSnap('ana', 'v-abcdefgh')).voice).toMatchObject({ status: 'failed' })
      expect((await store.retranscribeVoiceSnap('ben', 'v-abcdefgh')).voice).toMatchObject({ text: 'hello there' })
      // A live run is refused to everyone; one stalled past the window is anyone's.
      let finish!: (w: string) => void
      transcribe.mockImplementationOnce(() => new Promise<string>((r) => { finish = r }))
      const live = store.retranscribeVoiceSnap('ana', 'v-abcdefgh')
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      await expect(store.retranscribeVoiceSnap('ben', 'v-abcdefgh')).rejects.toMatchObject({ status: 409 })
      await expect(store.retranscribeVoiceSnap('ana', 'v-abcdefgh')).rejects.toMatchObject({ status: 409 })
      vi.setSystemTime(later(6))
      expect((await store.retranscribeVoiceSnap('ben', 'v-abcdefgh')).voice).toMatchObject({ text: 'hello there' })
      finish('too late')
      await live
    } finally { vi.useRealTimers() }
  })
  it('is not answered where voice notes are off', async () => {
    const { host, b } = fakeHost({ features: { voiceSnaps: true } })
    upload(b)
    const on = createCowitnessHandlers(host, createCowitnessStore(host))
    vi.mocked(host.member).mockResolvedValue('ana')
    await on.voice.POST(post(body))
    await Promise.all(scheduled.splice(0))
    const off = fakeHost()
    const routes = createCowitnessHandlers({ ...off.host, db: host.db, storage: host.storage })
    const res = await routes.voiceTranscribe.POST(post({}), id('v-abcdefgh'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'voice notes are not on here' })
  })
})

describe('a transcription overtaken by a newer one', () => {
  const NOW = new Date('2026-09-30T12:00:00.000Z')
  // Each call waits for the test to say what it heard, so the order of finishing is chosen here.
  function heldTranscriber() {
    const pending: ((w: string) => void)[] = []
    const transcribe = vi.fn(() => new Promise<string>((r) => { pending.push(r) }))
    return { transcribe, pending }
  }
  it('is dropped for a voice snap, whichever finishes first, and never clears the newer run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const { transcribe, pending } = heldTranscriber()
      const { host, b, f } = fakeHost({ features: { voiceSnaps: true }, transcription: { languages: ['en', 'fr'], transcribe } })
      const store = createCowitnessStore(host)
      upload(b)
      await createCowitnessHandlers(host, store).voice.POST(post(body))
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
      const second = store.retranscribeVoiceSnap('ana', 'v-abcdefgh', 'fr')
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      const secondStart = (f.raw('snaps', 'v-abcdefgh') as { voice: { startedAt: string } }).voice.startedAt
      // The stalled first run comes back first: dropped, and the second is still running.
      pending[0]('first words')
      await Promise.all(scheduled.splice(0))
      expect(f.raw('snaps', 'v-abcdefgh')).toMatchObject({ voice: { status: 'transcribing', startedAt: secondStart, text: '' } })
      pending[1]('second words')
      await second
      expect((f.raw('snaps', 'v-abcdefgh') as { voice: object }).voice).toEqual({ path: PATH, contentType: 'audio/mp4', durationSec: 9, language: 'fr', text: 'second words' })
    } finally { vi.useRealTimers() }
  })
  it('is dropped for a spoken reaction too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const { transcribe, pending } = heldTranscriber()
      const { host, b, f } = fakeHost({ features: { voiceSnaps: true }, transcription: { languages: ['en', 'fr'], transcribe } })
      const store = createCowitnessStore(host)
      const routes = createCowitnessHandlers(host, store)
      await routes.photo.POST(post({ photoId: 'p-photo0001' }))
      const rpath = 'p/snaps-audio/p-photo0001/r-reaction1.m4a'
      b.put(rpath, Buffer.from('abcd'), 'audio/mp4')
      as(host, 'ben')
      await routes.reactions.POST(post({ commentId: 'r-reaction1', contentType: 'audio/mp4', durationSec: 3 }), id('p-photo0001'))
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
      const second = store.retranscribeReaction('ben', 'p-photo0001', 'r-reaction1', 'fr')
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      pending[0]('first words')
      await Promise.all(scheduled.splice(0))
      const comment = () => (f.raw('snaps', 'p-photo0001') as { comments: { text: string; recording: { status?: string } }[] }).comments[0]
      expect(comment()).toMatchObject({ text: '', recording: { status: 'transcribing' } })
      pending[1]('second words')
      await second
      expect(comment()).toMatchObject({ text: 'second words' })
      expect(comment().recording).not.toHaveProperty('status')
    } finally { vi.useRealTimers() }
  })
})
