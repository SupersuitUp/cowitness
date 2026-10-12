import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { void fn() } }))
import { createCowitnessHandlers } from './handlers.js'
import type { CowitnessHost } from './host.js'
import type { CowitnessStore } from './store.js'

type M = 'ana' | 'ben'
const agentMember = vi.fn<(r: Request) => Promise<M | null>>()
const store = {
  finalizeSnapPhoto: vi.fn(async (m: M, id: string, x: { caption?: string }) => ({ id, by: m, kind: 'photo', caption: x.caption, witnessedAt: null })),
  finalizeSnapVideo: vi.fn(async (m: M, id: string) => ({ id, by: m, kind: 'video', witnessedAt: null })),
  voiceUploadUrl: vi.fn(async (_m: M, i: { snapId: string }) => ({ snapId: i.snapId, url: 'https://storage.example.com/v', requiredHeaders: { 'Content-Type': 'audio/mp4' } })),
  fileVoiceSnap: vi.fn(async (m: M, i: { snapId: string }) => ({ snap: { id: i.snapId, by: m, kind: 'voice', witnessedAt: null }, created: true })),
  transcribeVoiceSnap: vi.fn(),
  // Like the real store, a snap is visible to the member whoever authored it.
  getSnapView: vi.fn(async (_m: M, id: string) => ({
    there: { id, by: 'ana', witnessedAt: '2026-10-11T10:00:00.000Z', witnessedBy: { ben: '2026-10-11T10:00:00.000Z' }, comments: [{ text: 'hi' }], photoUrl: 'https://storage.example.com/signed' },
    theirs: { id, by: 'ben', witnessedAt: null, comments: [{ text: 'private' }], photoUrl: 'https://storage.example.com/signed2' },
  } as Record<string, unknown>)[id] ?? null),
}
const announce = { shared: vi.fn(), witnessed: vi.fn(), message: vi.fn(), heart: vi.fn() }
const host = {
  member: vi.fn(async () => null), announce,
  agent: { member: agentMember, photoTicket: vi.fn(async () => ({ photoId: 'ph1', url: 'https://storage.example.com/p' })), videoTicket: vi.fn(async () => ({ photoId: 'vd1', videoUrl: 'v', posterUrl: 'p', requiredHeaders: { video: {}, poster: {} } })) },
} as unknown as CowitnessHost<M>
const h = createCowitnessHandlers(host, store as unknown as CowitnessStore<M>)
const req = (body?: unknown) => new Request('https://app.example.com/api/snaps/agent', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) })

beforeEach(() => { vi.clearAllMocks(); agentMember.mockResolvedValue('ana') })

describe('the agent posts a snap', () => {
  it('refuses a request the agent key does not vouch for, and never reads the session', async () => {
    agentMember.mockResolvedValue(null)
    const t = await h.agent.ticket.POST(req({ kind: 'photo' }))
    expect(t.status).toBe(401)
    expect(await t.json()).toEqual({ error: 'agent key required' })
    expect((await h.agent.file.POST(req({ kind: 'photo', photoId: 'ph1' }))).status).toBe(401)
    expect((await h.agent.snap.GET(req(), { params: Promise.resolve({ id: 'there' }) })).status).toBe(401)
    expect(host.member).not.toHaveBeenCalled()
  })
  it('answers 401 for every route when the app has no agent block', async () => {
    const bare = createCowitnessHandlers({ ...host, agent: undefined } as unknown as CowitnessHost<M>, store as unknown as CowitnessStore<M>)
    expect((await bare.agent.ticket.POST(req({ kind: 'photo' }))).status).toBe(401)
    expect((await bare.agent.snap.GET(req(), { params: Promise.resolve({ id: 'there' }) })).status).toBe(401)
  })
  it('a photo: the app\'s own ticket, then filed as that member and announced as a share', async () => {
    expect(await (await h.agent.ticket.POST(req({ kind: 'photo', contentType: 'image/jpeg', size: 10 }))).json()).toMatchObject({ photoId: 'ph1', url: 'https://storage.example.com/p', headers: {} })
    const snap = await (await h.agent.file.POST(req({ kind: 'photo', photoId: 'ph1', caption: 'Saw this' }))).json()
    expect(snap).toMatchObject({ id: 'ph1', by: 'ana', caption: 'Saw this' })
    expect(announce.shared).toHaveBeenCalledOnce()
  })
  it('a video and a voice note go through the app\'s own pipelines', async () => {
    expect(await (await h.agent.ticket.POST(req({ kind: 'video', contentType: 'video/mp4', size: 10 }))).json()).toMatchObject({ photoId: 'vd1' })
    await h.agent.file.POST(req({ kind: 'video', photoId: 'vd1', meta: { durationSec: 3, width: 1080, height: 1920 } }))
    expect(store.finalizeSnapVideo).toHaveBeenCalledOnce()
    const v = await (await h.agent.ticket.POST(req({ kind: 'voice', contentType: 'audio/mp4', size: 10, durationSec: 4 }))).json()
    expect(v.photoId).toMatch(/^[A-Za-z0-9]{24}$/)
    expect(v).toMatchObject({ url: 'https://storage.example.com/v', headers: { 'Content-Type': 'audio/mp4' } })
    await h.agent.file.POST(req({ kind: 'voice', photoId: v.photoId, contentType: 'audio/mp4', meta: { durationSec: 4 } }))
    expect(store.fileVoiceSnap).toHaveBeenCalledWith('ana', expect.objectContaining({ snapId: v.photoId, durationSec: 4 }))
    expect(announce.shared).toHaveBeenCalledTimes(2)
  })
  it('refuses an unknown kind', async () => {
    expect((await h.agent.ticket.POST(req({ kind: 'gif' }))).status).toBe(400)
  })
  it('reads only its own snap back, and only the witness fields', async () => {
    const own = await (await h.agent.snap.GET(req(), { params: Promise.resolve({ id: 'there' }) })).json()
    expect(own).toEqual({ id: 'there', witnessedAt: '2026-10-11T10:00:00.000Z', witnessedBy: { ben: '2026-10-11T10:00:00.000Z' } })
    expect((await h.agent.snap.GET(req(), { params: Promise.resolve({ id: 'theirs' }) })).status).toBe(404)
  })
  it('a null body is a 400, not a 500', async () => {
    const nul = (path: string) => new Request(`https://app.example.com/api/snaps/agent${path}`, { method: 'POST', body: 'null' })
    expect((await h.agent.ticket.POST(nul('/ticket'))).status).toBe(400)
    expect((await h.agent.file.POST(nul(''))).status).toBe(400)
  })
  it('justUs and tags in a file body are ignored, for photo and video', async () => {
    await h.agent.file.POST(req({ kind: 'photo', photoId: 'ph1', justUs: true, tags: ['a'] }))
    expect(store.finalizeSnapPhoto.mock.calls[0]![2]).not.toHaveProperty('justUs')
    expect(store.finalizeSnapPhoto.mock.calls[0]![2]).not.toHaveProperty('tags')
    await h.agent.file.POST(req({ kind: 'video', photoId: 'vd1', justUs: true, tags: ['a'], meta: { durationSec: 3, width: 1080, height: 1920 } }))
    expect(store.finalizeSnapVideo.mock.calls[0]![2]).not.toHaveProperty('justUs')
    expect(store.finalizeSnapVideo.mock.calls[0]![2]).not.toHaveProperty('tags')
    await h.agent.file.POST(req({ kind: 'voice', photoId: 'x'.repeat(24), contentType: 'audio/mp4', justUs: true, tags: ['a'], meta: { durationSec: 4 } }))
    expect(store.fileVoiceSnap.mock.calls[0]![1]).not.toHaveProperty('justUs')
  })
  it('a voice note in an app with voice snaps off answers the package refusal', async () => {
    const { RuleError } = await import('../errors.js')
    store.voiceUploadUrl.mockRejectedValueOnce(new RuleError('voice snaps are off', 404))
    const r = await h.agent.ticket.POST(req({ kind: 'voice', contentType: 'audio/mp4', size: 10, durationSec: 4 }))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'voice snaps are off' })
  })
  it('404 when the snap is absent', async () => {
    expect((await h.agent.snap.GET(req(), { params: Promise.resolve({ id: 'gone' }) })).status).toBe(404)
  })
})
