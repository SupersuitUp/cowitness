import { vi } from 'vitest'
import { fakeFirestore } from './fake-firestore.js'
import { fakeBucket } from './fake-bucket.js'
import type { CowitnessHost } from '../../src/server/host.js'
import type { FiledMedia } from '../../src/types.js'

export type M = 'ana' | 'ben'
export const PHOTO: FiledMedia = {
  kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3024, height: 4032,
  paths: { original: 'p/original/x.jpg', display: 'p/display/x.jpg', thumb: 'p/thumb/x.jpg' },
}

// A whole host, every part a stand-in: the app's pipeline files media into the record the store
// hands it, signing is visible in the URL, and the transcriber says 'hello there'.
export function fakeHost(opts: { collection?: string; prefix?: string; transcription?: CowitnessHost<M>['transcription'] | null; isRefusal?: CowitnessHost<M>['isRefusal'] } = {}) {
  const f = fakeFirestore()
  const b = fakeBucket()
  const host: CowitnessHost<M> = {
    member: vi.fn(async () => 'ana' as M),
    db: () => f.db,
    collection: opts.collection ?? 'snaps',
    ...(opts.isRefusal ? { isRefusal: opts.isRefusal } : {}),
    storage: { bucket: () => b.bucket, prefix: opts.prefix ?? 'p/' },
    media: {
      urls: vi.fn(async (s) => ({ thumbUrl: s.paths.thumb ? `signed:${s.paths.thumb}` : null, displayUrl: s.paths.display ? `signed:${s.paths.display}` : null })),
      signedUrl: vi.fn(async (path: string) => `signed:${path}`),
      filePhoto: vi.fn(async (_m, _id, _t, into) => { const data = into.record(PHOTO); await into.ref.set(data); return data }),
      fileVideo: vi.fn(async (_m, _id, meta, into) => {
        const data = into.record({ ...PHOTO, kind: 'video', width: meta.width, height: meta.height, video: { path: 'p/video/x.mp4', posterPath: null, durationSec: meta.durationSec, contentType: 'video/mp4' } })
        await into.ref.set(data)
        return data
      }),
    },
    announce: { shared: vi.fn(), witnessed: vi.fn(), message: vi.fn(), heart: vi.fn() },
    ...(opts.transcription === null ? {} : { transcription: opts.transcription ?? { languages: ['en', 'fr'], transcribe: vi.fn(async () => 'hello there') } }),
  }
  return { host, f, b }
}
