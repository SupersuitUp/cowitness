import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./reencode.js', async (orig) => ({ ...(await orig<typeof import('./reencode.js')>()), toJpeg: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })) }))
// jsdom cannot decode video: metadata and the poster frame are stubbed, the rest is real.
vi.mock('./video-meta.js', async (orig) => ({
  ...(await orig<typeof import('./video-meta.js')>()),
  readVideoMeta: vi.fn(async () => ({ durationSec: 8.2, width: 1080, height: 1920 })),
  capturePoster: vi.fn(async () => new Blob(['poster'], { type: 'image/jpeg' })),
}))

import { postSnap } from './snap-upload.js'
import { toJpeg } from './reencode.js'

const SEP27 = new Date(2026, 8, 27, 14, 3, 0).getTime()
type Call = { url: string; method: string; body?: unknown }
let calls: Call[]

class FakeXHR {
  upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 200
  private req = { method: '', url: '' }
  open(method: string, url: string) { this.req = { method, url } }
  setRequestHeader() {}
  send(body: unknown) { calls.push({ ...this.req, body }); setTimeout(() => this.onload?.(), 0) }
}

beforeEach(() => {
  calls = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ url, method: init.method ?? 'GET', body })
    if (url === '/api/us/photos/upload-url') return new Response(JSON.stringify({ photoId: 'p1', url: 'https://put/p1' }))
    if (url === '/api/us/videos/upload-url') {
      return new Response(JSON.stringify({ photoId: 'v1', videoUrl: 'https://put/v1', posterUrl: 'https://put/poster', requiredHeaders: { video: {}, poster: {} } }))
    }
    return new Response(JSON.stringify({ id: 'x' }))
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('postSnap', () => {
  it('a photo goes up on the album\'s own ticket, then is filed as a snap with its caption', async () => {
    await postSnap(new File(['raw'], 'a.jpg', { type: 'image/jpeg', lastModified: SEP27 }), 'lunch')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/us/photos/upload-url', 'PUT https://put/p1', 'POST /api/us/snaps/photo',
    ])
    expect(calls[2].body).toEqual({ photoId: 'p1', caption: 'lunch', clientTakenAt: new Date(SEP27).toISOString() })
    // Never the album's finalize: a snap is not in any moment.
    expect(calls.some((c) => c.url === '/api/us/photos/finalize')).toBe(false)
  })

  it('a video goes up as the phone\'s own file with its poster, then is filed as a snap', async () => {
    await postSnap(new File(['moov'], 'b.mov', { type: 'video/quicktime', lastModified: SEP27 }), '')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/us/videos/upload-url', 'PUT https://put/v1', 'PUT https://put/poster', 'POST /api/us/snaps/video',
    ])
    expect(calls[3].body).toEqual({ photoId: 'v1', caption: '', durationSec: 8.2, width: 1080, height: 1920, takenAt: '2026-09-27T14:03:00' })
    expect(calls.some((c) => c.url === '/api/us/videos/finalize')).toBe(false)
  })

  it('a refused filing is an error the sheet can show', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (String(url) === '/api/us/photos/upload-url'
      ? new Response(JSON.stringify({ photoId: 'p1', url: 'https://put/p1' }))
      : String(url).startsWith('https://put') ? new Response('', { status: 200 })
      : new Response(JSON.stringify({ error: 'caption must be at most 500 characters' }), { status: 400 })))
    await expect(postSnap(new File(['raw'], 'a.jpg', { type: 'image/jpeg' }), 'x')).rejects.toThrow('caption must be at most 500 characters')
  })

  describe('a Send tried again', () => {
    const route = (filing: () => Response, lookup: () => Response = () => new Response('{}', { status: 404 })) =>
      vi.mocked(fetch).mockImplementation(async (url, init: RequestInit = {}) => {
        const u = String(url)
        calls.push({ url: u, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
        if (u === '/api/us/photos/upload-url') return new Response(JSON.stringify({ photoId: 'p2', url: 'https://put/p2' }))
        if (u.startsWith('https://put')) return new Response('', { status: 200 })
        if (u === '/api/us/snaps/photo' || u === '/api/us/snaps/video') return filing()
        if (u.startsWith('/api/us/snaps/')) return lookup()
        return new Response('{}')
      })
    const lost = () => new Response(JSON.stringify({ error: 'upload not found or expired' }), { status: 400 })
    const photo = () => new File(['raw'], 'a.jpg', { type: 'image/jpeg' })

    it('hands back what it stored before filing, so a failed filing can be retried alone', async () => {
      route(() => { throw new TypeError('network drop') })
      const onSent = vi.fn()
      await expect(postSnap(photo(), 'x', { onSent })).rejects.toThrow()
      expect(onSent).toHaveBeenCalledWith({ kind: 'photo', photoId: 'p2' })
    })

    it('files the photo already stored under the same id, and never uploads it twice', async () => {
      route(() => new Response(JSON.stringify({ id: 'p1' })))
      await postSnap(photo(), 'x', { sent: { kind: 'photo', photoId: 'p1' } })
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/us/snaps/photo'])
      expect(calls[0].body).toMatchObject({ photoId: 'p1', caption: 'x' })
    })

    it('an earlier filing that landed but whose answer was lost counts as sent, not as a second snap', async () => {
      route(lost, () => new Response(JSON.stringify({ id: 'p1' })))
      await postSnap(photo(), 'x', { sent: { kind: 'photo', photoId: 'p1' } })
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/us/snaps/photo', 'GET /api/us/snaps/p1'])
    })

    it('a stored copy that can never be filed starts over from a fresh ticket', async () => {
      let first = true
      route(() => (first ? ((first = false), lost()) : new Response(JSON.stringify({ id: 'p2' }))))
      const onSent = vi.fn()
      await postSnap(photo(), 'x', { sent: { kind: 'photo', photoId: 'p1' }, onSent })
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        'POST /api/us/snaps/photo', 'GET /api/us/snaps/p1', 'POST /api/us/photos/upload-url', 'PUT https://put/p2', 'POST /api/us/snaps/photo',
      ])
      expect(onSent).toHaveBeenCalledWith({ kind: 'photo', photoId: 'p2' })
    })

    it('a video already stored is filed again under its id, with no second upload', async () => {
      route(() => new Response(JSON.stringify({ id: 'v1' })))
      const meta = { durationSec: 8.2, width: 1080, height: 1920 }
      await postSnap(new File(['moov'], 'b.mov', { type: 'video/quicktime', lastModified: SEP27 }), '', { sent: { kind: 'video', photoId: 'v1', meta } })
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/us/snaps/video'])
      expect(calls[0].body).toEqual({ photoId: 'v1', caption: '', ...meta, takenAt: '2026-09-27T14:03:00' })
    })

    it('any other refusal is still an error the sheet can show', async () => {
      route(() => new Response(JSON.stringify({ error: 'caption must be at most 500 characters' }), { status: 400 }))
      await expect(postSnap(photo(), 'x', { sent: { kind: 'photo', photoId: 'p1' } })).rejects.toThrow('caption must be at most 500 characters')
      expect(calls.map((c) => c.url)).toEqual(['/api/us/snaps/photo'])
    })
  })

  it('does not re-encode bytes the camera already composed, because a second jpeg pass loses detail', async () => {
    const composed = new File(['already'], 'snap.jpg', { type: 'image/jpeg', lastModified: SEP27 })
    await postSnap(composed, 'ours', { composed: true })
    expect(toJpeg).not.toHaveBeenCalled()
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.body).toBe(composed)
  })

  it('still re-encodes a photo chosen from the library, which carries EXIF and any orientation', async () => {
    await postSnap(new File(['raw'], 'IMG_1.HEIC', { type: 'image/heic', lastModified: SEP27 }), 'theirs')
    expect(toJpeg).toHaveBeenCalledTimes(1)
  })
})
