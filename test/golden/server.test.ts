// @vitest-environment node
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { createCowitnessHandlers } from '../../src/server/handlers.js'
import { createCowitnessStore } from '../../src/server/store.js'
import { fakeHost, type M } from '../support/fake-host.js'
import { golden } from './golden.js'

const { queue } = vi.hoisted(() => ({ queue: [] as (() => Promise<unknown>)[] }))
// after() runs once the response has gone; the scenario runs the queue itself after each request.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { queue.push(fn) } }))

const T0 = Date.parse('2026-09-30T12:00:00.000Z')
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.spyOn(Math, 'random').mockReturnValue(0.123456789) })
afterAll(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const req = (method: string, body?: unknown) => new Request('https://x/api/snaps', {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const id = (x: string) => ({ params: Promise.resolve({ id: x }) })
const rid = (x: string, c: string) => ({ params: Promise.resolve({ id: x, commentId: c }) })

async function answer(res: Response) {
  const location = res.headers.get('location')
  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* a redirect or an empty body stays text */ }
  return { status: res.status, ...(location ? { location } : {}), body }
}

describe('options off: every answer, record and host call is 0.1.3', () => {
  it('reproduces the recorded scenario', async () => {
    const { host, f, b } = fakeHost()
    const store = createCowitnessStore(host)
    const h = createCowitnessHandlers(host, store)
    const as = (m: M | null) => vi.mocked(host.member).mockResolvedValue(m)
    const calls = () => {
      const out = {
        announce: Object.fromEntries(Object.entries(host.announce).map(([k, fn]) => [k, vi.mocked(fn).mock.calls])),
        filePhoto: vi.mocked(host.media.filePhoto).mock.calls.map((c) => c.slice(0, 3)),
        fileVideo: vi.mocked(host.media.fileVideo).mock.calls.map((c) => c.slice(0, 3)),
        transcribe: vi.mocked(host.transcription!.transcribe).mock.calls.map(([a, ct, o]) => [a.length, ct, o]),
      }
      vi.clearAllMocks()
      return out
    }
    const log: unknown[] = []
    let t = 0
    let last: { body: unknown } = { body: null }
    const step = async (name: string, m: M | null, call: () => Promise<Response>) => {
      vi.setSystemTime(T0 + (t += 60_000))
      as(m)
      const a = await answer(await call())
      while (queue.length) await queue.shift()!()
      last = a
      log.push({ name, answer: a, stored: f.all('snaps'), calls: calls() })
    }
    const lastCommentId = () => ((last.body as { comments?: { id: string }[] }).comments ?? []).at(-1)!.id

    await step('a stranger lists', null, () => h.snaps.GET(req('GET')))
    await step('ana files a photo', 'ana', () => h.photo.POST(req('POST', { photoId: 'g1', caption: ' morning ' })))
    await step('ben files a video', 'ben', () => h.video.POST(req('POST', { photoId: 'g2', caption: '', durationSec: 4, width: 720, height: 1280, takenAt: '2026-09-30T07:00:00' })))
    await step('ben files a caption over the cap', 'ben', () => h.photo.POST(req('POST', { photoId: 'g3', caption: 'x'.repeat(501) })))
    await step('ana lists', 'ana', () => h.snaps.GET(req('GET')))
    await step('ana reads g2', 'ana', () => h.snap.GET(req('GET'), id('g2')))
    await step('ana writes under g2', 'ana', () => h.snap.PATCH(req('PATCH', { kind: 'comment', text: ' hi ' }), id('g2')))
    const c1 = lastCommentId()
    await step('ben hearts it', 'ben', () => h.snap.PATCH(req('PATCH', { kind: 'comment-heart', commentId: c1, value: true }), id('g2')))
    await step('ben hearts it again', 'ben', () => h.snap.PATCH(req('PATCH', { kind: 'comment-heart', commentId: c1, value: true }), id('g2')))
    await step('ana witnesses g2 with words', 'ana', () => h.snap.PATCH(req('PATCH', { kind: 'witness', text: ' seen ' }), id('g2')))
    await step('ben tries to witness his own g2', 'ben', () => h.snap.PATCH(req('PATCH', { kind: 'witness' }), id('g2')))
    await step('ben witnesses g1', 'ben', () => h.snap.PATCH(req('PATCH', { kind: 'witness' }), id('g1')))
    await step('ana hides g1', 'ana', () => h.snap.PATCH(req('PATCH', { kind: 'hide' }), id('g1')))
    await step('ben reads hidden g1', 'ben', () => h.snap.GET(req('GET'), id('g1')))
    await step('ana brings g1 back', 'ana', () => h.snap.PATCH(req('PATCH', { kind: 'unhide' }), id('g1')))
    await step('an unknown patch', 'ana', () => h.snap.PATCH(req('PATCH', { kind: 'tag', ids: ['t-first'] }), id('g1')))
    await step('ben asks for a reaction ticket', 'ben', () => h.reactionUploadUrl.POST(req('POST', { contentType: 'audio/mp4', size: 4, durationSec: 3, commentId: 'r-golden01' }), id('g1')))
    b.put('p/snaps-audio/g1/r-golden01.m4a', Buffer.from('abcd'), 'audio/mp4')
    await step('ben files the reaction', 'ben', () => h.reactions.POST(req('POST', { commentId: 'r-golden01', contentType: 'audio/mp4', durationSec: 3 }), id('g1')))
    await step('ben files it again', 'ben', () => h.reactions.POST(req('POST', { commentId: 'r-golden01', contentType: 'audio/mp4', durationSec: 3 }), id('g1')))
    await step('ana transcribes it again', 'ana', () => h.reactionTranscribe.POST(req('POST', { language: 'fr' }), rid('g1', 'r-golden01')))
    await step('ana listens', 'ana', () => h.reactionAudio.GET(req('GET'), rid('g1', 'r-golden01')))
    await step('a voice address that does not exist yet', 'ana', () => h.snap.GET(req('GET'), id('voice')))

    const reads = {
      homeAna: await store.listCowitness('ana'), homeBen: await store.listCowitness('ben'),
      shelfBen: await store.listWitnessed('ben'), queueAna: await store.listQueue('ana'),
      tileAna: await store.cowitnessSummary('ana', '1970-01-01T00:00:00.000Z'),
      tileBen: await store.cowitnessSummary('ben', new Date(T0 + 5 * 60_000).toISOString()),
    }
    golden('server', { log, reads })
  })
})
