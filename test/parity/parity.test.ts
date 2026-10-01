// @vitest-environment node
// Cowitness, package against Us at 7e65c60, over records shaped like us_snaps. Plan 4 moves Us
// onto the package behind this proof: if any line here fails, someone would see a change.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mod from '../../src/snap-rules.js'
import * as modShared from '../../src/shared-rules.js'
import { snapRow as modRow } from '../../src/format.js'
import { streaksOf as modStreaks } from '../../src/streak.js'
import * as old from './oracle/snap-rules.js'
import * as oldShared from './oracle/rules.js'
import { snapRow as oldRow } from './oracle/cowitness-format.js'
import { streaksOf as oldStreaks } from './oracle/streak.js'
import { createCowitnessStore } from '../../src/server/store.js'
import { fakeHost } from '../support/fake-host.js'

type Stored = Record<string, Record<string, unknown>>
const stored = JSON.parse(readFileSync(join(__dirname, 'fixtures/us_snaps.json'), 'utf8')) as Stored
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snaps = Object.entries(stored).map(([id, d]) => ({ id, ...d })) as any[]
const MEMBERS = ['ana', 'ben'] as const
const NOW = '2026-09-30T12:00:00.000Z'
const SEEN = ['1970-01-01T00:00:00.000Z', '2026-09-28T00:00:00.000Z', '2026-09-30T08:00:00.000Z', NOW]
const ids = (xs: { id: string }[]) => xs.map((x) => x.id)
const comments = (s: { comments?: { id: string; at: string; recording?: never }[] }) => s.comments ?? []

// What a call produced, or how it refused: the same refusal is the same words and status.
function outcome(f: () => unknown) {
  try { return { ok: f() } } catch (e) { const err = e as { message: string; status?: number }; return { refused: err.message, status: err.status } }
}

const PATCHES = [
  { kind: 'comment', text: '  hello  ' }, { kind: 'comment', text: '' },
  { kind: 'comment', text: '', images: [{ id: 'img9', width: 10, height: 10 }] },
  { kind: 'comment-heart', commentId: 'c-s1-1', value: true }, { kind: 'comment-heart', commentId: 'c-s1-1', value: false },
  { kind: 'comment-heart', commentId: 'c-s1-2', value: true }, { kind: 'comment-heart', commentId: 'missing', value: true },
  { kind: 'hide' }, { kind: 'unhide' }, { kind: 'witness' }, { kind: 'witness', text: '  so good  ' },
] as const

describe('Cowitness parity with Us at 7e65c60', () => {
  for (const m of MEMBERS) {
    describe(`for ${m}`, () => {
      it('the same shelves and queue, in the same order, and the same cover', () => {
        expect(ids(mod.archiveOf(snaps, m))).toEqual(ids(old.archiveOf(snaps, m)))
        expect(ids(mod.openOf(snaps, m))).toEqual(ids(old.openOf(snaps, m)))
        expect(ids(mod.witnessedOf(snaps, m))).toEqual(ids(old.witnessedOf(snaps, m)))
        expect(ids(mod.queueOf(snaps, m))).toEqual(ids(old.queueOf(snaps, m)))
        expect(mod.coverOf(snaps, m)?.id).toEqual(old.coverOf(snaps, m)?.id)
      })

      it('the same tile and the same new marks at every last-seen time, and the same visibility', () => {
        for (const seen of SEEN) {
          expect(mod.cowitnessTile(snaps, m, seen, 'https://cover')).toEqual(old.cowitnessTile(snaps, m, seen, 'https://cover'))
          for (const s of snaps) expect(mod.snapHasNew(s, m, seen)).toBe(old.snapHasNew(s, m, seen))
        }
        for (const s of snaps) expect(mod.canSeeSnap(s, m)).toBe(old.canSeeSnap(s, m))
      })

      it('every patch lands or refuses the same way on every snap', () => {
        for (const s of snaps) for (const p of PATCHES) {
          expect(outcome(() => mod.applySnapPatch(s, m, p as never, { now: NOW, id: 'c-fixed' })))
            .toEqual(outcome(() => old.applySnapPatch(s, m, p as never, { now: NOW, id: 'c-fixed' })))
        }
      })

      it('a spoken reaction is filed, marked, written down and failed the same way', () => {
        const rec = { path: 'us/snaps-audio/x/r-new-0001.m4a', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' as const }
        for (const s of snaps) {
          expect(outcome(() => mod.addVoiceReaction(s, m, 'r-new-0001', rec, { now: NOW }))).toEqual(outcome(() => old.addVoiceReaction(s, m, 'r-new-0001', rec, { now: NOW })))
          for (const c of comments(s)) {
            expect(outcome(() => mod.markTranscribing(s, c.id, 'fr', { now: NOW }))).toEqual(outcome(() => old.markTranscribing(s, c.id, 'fr', { now: NOW })))
            expect(outcome(() => mod.setReactionTranscript(s, c.id, ' words '))).toEqual(outcome(() => old.setReactionTranscript(s, c.id, ' words ')))
            expect(outcome(() => mod.setReactionTranscript(s, c.id, '   '))).toEqual(outcome(() => old.setReactionTranscript(s, c.id, '   ')))
            expect(outcome(() => mod.failReactionTranscript(s, c.id, 'x'))).toEqual(outcome(() => old.failReactionTranscript(s, c.id, 'x')))
          }
        }
      })
    })
  }

  it('the same rows, thumbnails and streaks', () => {
    for (const s of snaps) {
      expect(mod.thumbPathOf(s)).toBe(old.thumbPathOf(s))
      expect(modRow(s, 'https://t')).toEqual(oldRow(s, 'https://t'))
      expect(modRow(s)).toEqual(oldRow(s))
    }
    const rows = snaps.map((s) => modRow(s))
    for (const day of [25, 26, 27, 28, 29, 30]) {
      const now = new Date(2026, 8, day, 18)
      expect(modStreaks(rows, now, MEMBERS)).toEqual(oldStreaks(rows, now))
    }
  })

  it('the same storage paths, retry windows, clip, caption and id verdicts', () => {
    for (const ct of ['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/flac']) {
      expect(mod.reactionAudioPath('us/', 's1', 'c9', ct)).toBe(old.reactionAudioPath('s1', 'c9', ct))
    }
    for (const s of snaps) for (const c of comments(s)) {
      const r = (c as { recording?: Parameters<typeof old.canRetranscribe>[0] }).recording
      if (!r) continue
      for (const now of [NOW, '2026-09-29T13:04:00.000Z', '2026-09-29T13:06:00.000Z']) {
        expect(mod.canRetranscribe(r, c.at, now)).toBe(old.canRetranscribe(r, c.at, now))
      }
      expect(mod.canAutoTranscribe(r)).toBe(old.canAutoTranscribe(r))
    }
    const clips = [
      { contentType: 'audio/mp4', size: 10, durationSec: 180 }, { contentType: 'audio/mp4', size: 10, durationSec: 186 },
      { contentType: 'audio/flac', size: 10, durationSec: 3 }, { contentType: 'audio/webm;codecs=opus', size: 41943041, durationSec: 3 },
    ]
    for (const c of clips) expect(outcome(() => mod.validateReactionClip(c))).toEqual(outcome(() => old.validateReactionClip(c)))
    for (const v of [undefined, null, 'x', 3, ' a ', 'x'.repeat(501)]) expect(outcome(() => mod.validateCaption(v))).toEqual(outcome(() => old.validateCaption(v)))
    for (const v of ['r-abcdefgh', 'short', 'has space here', 'x'.repeat(65), 5]) expect(outcome(() => mod.validateCommentId(v))).toEqual(outcome(() => old.validateCommentId(v)))
    expect(mod.reactionTicket('c', true, '', {})).toEqual(old.reactionTicket('c', true, '', {}))
    expect(mod.REACTION_MAX_SEC).toBe(old.REACTION_MAX_SEC)
    expect(mod.SNAP_CAPTION_MAX).toBe(old.SNAP_CAPTION_MAX)
  })

  it("the shared message and media rules give Us's answers", () => {
    for (const c of [{ text: 'hi' }, { text: '', images: [{ id: 'a', width: 1, height: 1 }] }, { text: '' }]) {
      expect(modShared.messageSummary(c)).toBe(oldShared.messageSummary(c))
    }
    for (const t of ['2026-09-27T14:03:00', '2026-09-27T14:03:00+02:00', '2026-09-27T14:03:00Z', '2026-02-30T10:00:00', undefined, 5]) {
      expect(outcome(() => modShared.localTakenAt(t))).toEqual(outcome(() => oldShared.localTakenAt(t)))
    }
    for (const d of [{ durationSec: 8.2, width: 1080, height: 1920 }, { durationSec: 0, width: 1, height: 1 }, { durationSec: 3, width: 1.5, height: 1 }]) {
      expect(outcome(() => modShared.validateVideoDims(d))).toEqual(outcome(() => oldShared.validateVideoDims(d)))
    }
    for (const x of [undefined, [{ id: 'a', width: 1, height: 1 }], [{ id: '../a', width: 1, height: 1 }], 'no']) {
      expect(outcome(() => modShared.validateCommentImages(x))).toEqual(outcome(() => oldShared.validateCommentImages(x)))
    }
    expect(modShared.MESSAGE_MAX).toBe(oldShared.NOTE_MAX)
    expect(modShared.CLIP_MAX_BYTES).toBe(oldShared.CLIP_MAX_BYTES)
    expect(modShared.VIDEO_MAX_BYTES).toBe(oldShared.VIDEO_MAX_BYTES)
  })
})

describe('round trip through the store, on records shaped like us_snaps', () => {
  const setup = () => {
    const { host, f, b } = fakeHost({ collection: 'us_snaps', prefix: 'us/' })
    f.seed('us_snaps', stored)
    return { host, f, b, store: createCowitnessStore(host) }
  }

  it('reads every stored snap exactly as stored, adding only its id', async () => {
    const { store } = setup()
    const read = await store.readSnaps()
    expect(Object.fromEntries(read.map(({ id, ...rest }) => [id, rest]))).toStrictEqual(stored)
  })

  it('a witness writes witnessedAt and nothing else', async () => {
    const { f, store } = setup()
    await store.patchSnap('ana', 's2', { kind: 'witness' }, { now: NOW })
    expect(f.raw('us_snaps', 's2')).toStrictEqual({ ...stored.s2, witnessedAt: NOW })
  })

  it('an un-heart removes that one mark and nothing else', async () => {
    const { f, store } = setup()
    await store.patchSnap('ana', 's1', { kind: 'comment-heart', commentId: 'c-s1-1', value: false }, { now: NOW })
    const s1 = structuredClone(stored.s1) as { comments: { hearts?: object }[] }
    s1.comments[0].hearts = {}
    expect(f.raw('us_snaps', 's1')).toStrictEqual(s1)
  })

  it('hide and bring back touch only hiddenAt', async () => {
    const { f, store } = setup()
    await store.patchSnap('ben', 's7', { kind: 'hide' }, { now: NOW })
    expect(f.raw('us_snaps', 's7')).toStrictEqual({ ...stored.s7, hiddenAt: NOW })
    await store.patchSnap('ben', 's7', { kind: 'unhide' }, { now: NOW })
    expect(f.raw('us_snaps', 's7')).toStrictEqual(stored.s7)
  })

  it("a spoken reaction lands at Us's path as one message, and its words change only that message", async () => {
    const { b, f, store } = setup()
    b.put('us/snaps-audio/s2/r-new-000001.m4a', Buffer.from('aa'))
    await store.attachReaction('ana', 's2', { commentId: 'r-new-000001', contentType: 'audio/mp4', durationSec: 4 })
    expect(f.raw('us_snaps', 's2')).toStrictEqual({
      ...stored.s2,
      comments: [{ id: 'r-new-000001', by: 'ana', text: '', at: expect.any(String), recording: { path: 'us/snaps-audio/s2/r-new-000001.m4a', contentType: 'audio/mp4', durationSec: 4, status: 'transcribing' } }],
    })
    await store.transcribeReaction('s2', 'r-new-000001')
    const after = f.raw('us_snaps', 's2') as { comments: Record<string, unknown>[] }
    expect(after.comments[0]).toStrictEqual({ id: 'r-new-000001', by: 'ana', text: 'hello there', at: expect.any(String), recording: { path: 'us/snaps-audio/s2/r-new-000001.m4a', contentType: 'audio/mp4', durationSec: 4 } })
    expect({ ...after, comments: undefined }).toStrictEqual({ ...stored.s2, comments: undefined })
  })

  it("the other person's hidden snap is untouched by every refusal", async () => {
    const { f, store } = setup()
    for (const p of PATCHES) await store.patchSnap('ana', 's3', p as never, { now: NOW }).catch(() => null)
    expect(f.raw('us_snaps', 's3')).toStrictEqual(stored.s3)
  })
})
