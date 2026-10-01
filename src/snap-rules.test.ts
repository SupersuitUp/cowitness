import { describe, it, expect } from 'vitest'
import {
  SNAP_CAPTION_MAX, validateCaption, canSeeSnap, newSnap, applySnapPatch, archiveOf, snapHasNew, cowitnessTile, coverOf, queueOf, openOf, witnessedOf, thumbPathOf,
  REACTION_MAX_SEC, reactionAudioPath, validateReactionClip, validateCommentId, reactionTicket, addVoiceReaction,
  markTranscribing, setReactionTranscript, failReactionTranscript, canAutoTranscribe, canRetranscribe,
} from './snap-rules.js'
import { RuleError, MESSAGE_MAX, NOTHING_HEARD } from './shared-rules.js'
import type { FiledMedia, Snap } from './types.js'

const NOW = '2026-09-27T20:00:00.000Z'
const PHOTO: FiledMedia = {
  kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3024, height: 4032,
  paths: { original: 'us/original/s1.jpg', display: 'us/display/s1.jpg', thumb: 'us/thumb/s1.jpg' },
}
const snap = (o: Partial<Snap> = {}): Snap => ({
  id: 's1', ...newSnap('ben', PHOTO, '', '2026-09-27T14:05:00.000Z'), ...o,
})

describe('a snap', () => {
  it('is filed with its media, its caption, unwitnessed and visible', () => {
    expect(newSnap('ana', PHOTO, 'lunch', NOW)).toEqual({
      by: 'ana', caption: 'lunch', kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3024, height: 4032,
      paths: PHOTO.paths, witnessedAt: null, hiddenAt: null, createdAt: NOW,
    })
  })

  it('carries a video block when it is a video', () => {
    const video: FiledMedia = {
      kind: 'video', takenAt: '2026-09-27T14:03:00', width: 1080, height: 1920,
      paths: { original: 'us/video/s2.mov', display: 'us/poster/s2.jpg', thumb: 'us/poster/s2.jpg' },
      video: { path: 'us/video/s2.mov', posterPath: 'us/poster/s2.jpg', durationSec: 8.2, contentType: 'video/quicktime' },
    }
    expect(newSnap('ana', video, '', NOW)).toMatchObject({ kind: 'video', video: video.video })
  })

  it('a caption is optional, trimmed, and capped', () => {
    expect(validateCaption(undefined)).toBe('')
    expect(validateCaption('  the view  ')).toBe('the view')
    expect(validateCaption('x'.repeat(SNAP_CAPTION_MAX))).toHaveLength(SNAP_CAPTION_MAX)
    expect(() => validateCaption('x'.repeat(SNAP_CAPTION_MAX + 1))).toThrow(RuleError)
    expect(() => validateCaption(7)).toThrow(RuleError)
  })

  it('a hidden snap is seen only by the member who posted it', () => {
    expect(canSeeSnap(snap(), 'ana')).toBe(true)
    expect(canSeeSnap(snap({ hiddenAt: NOW }), 'ana')).toBe(false)
    expect(canSeeSnap(snap({ hiddenAt: NOW }), 'ben')).toBe(true)
  })
})

describe('patching a snap', () => {
  it('takes a message from either member, the way every photo does', () => {
    const s = applySnapPatch(snap(), 'ana', { kind: 'comment', text: ' beautiful ' }, { now: NOW, id: 'c1' })
    expect(s.comments).toEqual([{ id: 'c1', by: 'ana', text: 'beautiful', at: NOW }])
  })

  it('a heart goes on the other member\'s message only', () => {
    const s = applySnapPatch(snap(), 'ana', { kind: 'comment', text: 'hi' }, { now: NOW, id: 'c1' })
    expect(applySnapPatch(s, 'ben', { kind: 'comment-heart', commentId: 'c1', value: true }, { now: NOW }).comments?.[0].hearts).toEqual({ ben: NOW })
    expect(() => applySnapPatch(s, 'ana', { kind: 'comment-heart', commentId: 'c1', value: true })).toThrow(RuleError)
  })

  it('only the member who posted it can hide it, and hiding twice keeps the first time', () => {
    const hidden = applySnapPatch(snap(), 'ben', { kind: 'hide' }, { now: NOW })
    expect(hidden.hiddenAt).toBe(NOW)
    expect(applySnapPatch(hidden, 'ben', { kind: 'hide' }, { now: 'later' }).hiddenAt).toBe(NOW)
    expect(() => applySnapPatch(snap(), 'ana', { kind: 'hide' })).toThrow(RuleError)
  })

  it('only the member who posted it brings it back, and nobody else can touch it while hidden', () => {
    const hidden = snap({ hiddenAt: NOW })
    expect(applySnapPatch(hidden, 'ben', { kind: 'unhide' }).hiddenAt).toBeNull()
    expect(() => applySnapPatch(hidden, 'ana', { kind: 'unhide' })).toThrow(RuleError)
    expect(() => applySnapPatch(hidden, 'ana', { kind: 'comment', text: 'hi' })).toThrow(RuleError)
  })
})

describe('the archive and the tile', () => {
  const a = snap({ id: 'a', by: 'ana', createdAt: '2026-09-25T10:00:00.000Z' })
  const b = snap({ id: 'b', by: 'ben', createdAt: '2026-09-26T10:00:00.000Z' })
  const c = snap({ id: 'c', by: 'ben', createdAt: '2026-09-27T10:00:00.000Z', hiddenAt: NOW })

  it('is both members in one stream, newest first, hidden ones only for whoever hid them', () => {
    expect(archiveOf([a, b, c], 'ana').map((s) => s.id)).toEqual(['b', 'a'])
    expect(archiveOf([a, b, c], 'ben').map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('is new when the other member posted, or wrote under one, since I last looked', () => {
    expect(snapHasNew(b, 'ana', '2026-09-26T00:00:00.000Z')).toBe(true)
    expect(snapHasNew(b, 'ana', '2026-09-26T12:00:00.000Z')).toBe(false)
    expect(snapHasNew(b, 'ben', '1970-01-01T00:00:00.000Z')).toBe(false)
    const written = snap({ by: 'ana', createdAt: '2026-09-20T00:00:00.000Z', comments: [{ id: 'c1', by: 'ben', text: 'x', at: '2026-09-27T00:00:00.000Z' }] })
    expect(snapHasNew(written, 'ana', '2026-09-26T00:00:00.000Z')).toBe(true)
  })

  it('the tile counts what I can see, says whether anything is new, and takes the cover it is given', () => {
    expect(cowitnessTile([a, b, c], 'ana', '2026-09-26T00:00:00.000Z', 'https://x/t.jpg')).toEqual({ count: 2, coverUrl: 'https://x/t.jpg', hasNew: true, waiting: 1 })
    expect(cowitnessTile([], 'ana', '1970-01-01T00:00:00.000Z', null)).toEqual({ count: 0, coverUrl: null, hasNew: false, waiting: 0 })
  })

  it('the cover is the newest visible snap that has an image', () => {
    const noPoster = snap({ id: 'v', kind: 'video', createdAt: '2026-09-28T00:00:00.000Z', paths: { original: 'us/video/v.mov', display: '', thumb: '' } })
    expect(coverOf([a, b, c, noPoster], 'ana')?.id).toBe('b')
    expect(coverOf([], 'ana')).toBeNull()
  })
})

describe('the home and the witnessed shelf', () => {
  const open = snap({ id: 'open', by: 'ben', createdAt: '2026-09-27T10:00:00.000Z' })
  const mine = snap({ id: 'mine', by: 'ana', createdAt: '2026-09-27T11:00:00.000Z' })
  const seen = snap({ id: 'seen', by: 'ben', createdAt: '2026-09-27T12:00:00.000Z', witnessedAt: NOW })
  const seenMine = snap({ id: 'seenMine', by: 'ana', createdAt: '2026-09-27T09:00:00.000Z', witnessedAt: NOW })
  const hid = snap({ id: 'hid', by: 'ana', createdAt: '2026-09-27T08:00:00.000Z', hiddenAt: NOW })

  it('the home keeps only what nobody has witnessed yet, newest first, and a hidden one stays with whoever hid it', () => {
    expect(openOf([open, mine, seen, seenMine, hid], 'ana').map((s) => s.id)).toEqual(['mine', 'open', 'hid'])
    expect(openOf([open, mine, seen, seenMine, hid], 'ben').map((s) => s.id)).toEqual(['mine', 'open'])
  })

  it('everything witnessed, from either side, moves to the shelf, newest first', () => {
    expect(witnessedOf([open, mine, seen, seenMine, hid], 'ana').map((s) => s.id)).toEqual(['seen', 'seenMine'])
  })

  it('a tile needs one image: the thumbnail, or a video\'s poster, or nothing', () => {
    expect(thumbPathOf(open)).toBe('us/thumb/s1.jpg')
    const video = snap({ kind: 'video', paths: { original: 'us/video/v.mov', display: '', thumb: '' }, video: { path: 'us/video/v.mov', posterPath: 'us/poster/v.jpg', durationSec: 3, contentType: 'video/mp4' } as Snap['video'] })
    expect(thumbPathOf(video)).toBe('us/poster/v.jpg')
    expect(thumbPathOf(snap({ kind: 'video', paths: { original: 'us/video/v.mov', display: '', thumb: '' } }))).toBeNull()
  })
})

describe('witnessing', () => {
  const theirs = snap({ by: 'ben' })

  it('marks the snap witnessed the first time, and keeps that time', () => {
    const once = applySnapPatch(theirs, 'ana', { kind: 'witness' }, { now: NOW })
    expect(once.witnessedAt).toBe(NOW)
    expect(once.comments).toBeUndefined()
    expect(applySnapPatch(once, 'ana', { kind: 'witness' }, { now: 'later' }).witnessedAt).toBe(NOW)
  })

  it('a typed reaction becomes a message under the snap, in the same write', () => {
    const s = applySnapPatch(theirs, 'ana', { kind: 'witness', text: '  I love this  ' }, { now: NOW, id: 'c1' })
    expect(s.witnessedAt).toBe(NOW)
    expect(s.comments).toEqual([{ id: 'c1', by: 'ana', text: 'I love this', at: NOW }])
  })

  it('moving on in silence still counts as witnessing it', () => {
    expect(applySnapPatch(theirs, 'ana', { kind: 'witness', text: '   ' }, { now: NOW }).witnessedAt).toBe(NOW)
  })

  it('nobody witnesses their own snap, and a hidden one cannot be witnessed', () => {
    expect(() => applySnapPatch(theirs, 'ben', { kind: 'witness' })).toThrow(RuleError)
    expect(() => applySnapPatch(snap({ by: 'ben', hiddenAt: NOW }), 'ana', { kind: 'witness' })).toThrow(RuleError)
  })

  it('the queue is the other member\'s unwitnessed, visible snaps, oldest first', () => {
    const q = [
      snap({ id: 'new', by: 'ben', createdAt: '2026-09-27T12:00:00.000Z' }),
      snap({ id: 'old', by: 'ben', createdAt: '2026-09-27T09:00:00.000Z' }),
      snap({ id: 'seen', by: 'ben', createdAt: '2026-09-27T08:00:00.000Z', witnessedAt: NOW }),
      snap({ id: 'hid', by: 'ben', createdAt: '2026-09-27T07:00:00.000Z', hiddenAt: NOW }),
      snap({ id: 'mine', by: 'ana', createdAt: '2026-09-27T06:00:00.000Z' }),
    ]
    expect(queueOf(q, 'ana').map((s) => s.id)).toEqual(['old', 'new'])
    expect(queueOf(q, 'ben').map((s) => s.id)).toEqual(['mine'])
  })
})

describe('a spoken reaction', () => {
  const rec = { path: 'us/snaps-audio/s1/c9.webm', contentType: 'audio/webm', durationSec: 12 }

  it('lives under its snap, named by its message id, with the right extension', () => {
    expect(reactionAudioPath('us/', 's1', 'c9', 'audio/webm')).toBe('us/snaps-audio/s1/c9.webm')
    expect(reactionAudioPath('us/', 's1', 'c9', 'audio/mp4')).toBe('us/snaps-audio/s1/c9.m4a')
  })

  it('is at most three minutes, with a few seconds of grace for a slow stop', () => {
    expect(validateReactionClip({ contentType: 'audio/mp4', size: 1000, durationSec: 180 })).toEqual({ contentType: 'audio/mp4', size: 1000, durationSec: 180 })
    expect(validateReactionClip({ contentType: 'audio/webm;codecs=opus', size: 1000, durationSec: 184 }).contentType).toBe('audio/webm')
    expect(() => validateReactionClip({ contentType: 'audio/webm', size: 1000, durationSec: REACTION_MAX_SEC + 6 })).toThrow(RuleError)
    expect(() => validateReactionClip({ contentType: 'video/mp4', size: 1000, durationSec: 3 })).toThrow(RuleError)
  })

  it('becomes a message with the recording and no words yet, once, however often it is filed', () => {
    const s = addVoiceReaction(snap(), 'ana', 'c9', rec, { now: NOW })
    expect(s.comments).toEqual([{ id: 'c9', by: 'ana', text: '', at: NOW, recording: rec }])
    expect(addVoiceReaction(s, 'ana', 'c9', rec, { now: 'later' }).comments).toHaveLength(1)
  })

  it('cannot go under a snap hidden from the speaker', () => {
    expect(() => addVoiceReaction(snap({ hiddenAt: NOW }), 'ana', 'c9', rec)).toThrow(RuleError)
  })

  it('takes an id the client already minted, so a resend can reuse it, and refuses a malformed one', () => {
    expect(validateCommentId('r-1a2b3c-d4e5f6')).toBe('r-1a2b3c-d4e5f6')
    expect(() => validateCommentId('short')).toThrow(RuleError)
    expect(() => validateCommentId('has a space')).toThrow(RuleError)
    expect(() => validateCommentId('a'.repeat(65))).toThrow(RuleError)
    expect(() => validateCommentId(undefined)).toThrow(RuleError)
    try {
      validateCommentId('short')
    } catch (e) {
      expect((e as RuleError).status).toBe(400)
    }
  })

  it('answers with nothing to PUT to when the bytes are already there, and a URL otherwise', () => {
    expect(reactionTicket('r-1a2b3c-d4e5f6', true, 'https://unused', { ignored: 'x' })).toEqual({ commentId: 'r-1a2b3c-d4e5f6', uploaded: true })
    expect(reactionTicket('r-1a2b3c-d4e5f6', false, 'https://put', { 'Content-Type': 'audio/mp4' })).toEqual({
      commentId: 'r-1a2b3c-d4e5f6', url: 'https://put', requiredHeaders: { 'Content-Type': 'audio/mp4' },
    })
  })
})

describe('a reaction\'s words', () => {
  const rec = { path: 'us/snaps-audio/s1/c9.m4a', contentType: 'audio/mp4', durationSec: 9 }
  const spoken = addVoiceReaction(snap(), 'ana', 'c9', rec, { now: NOW })
  const hasUndefined = (v: unknown): boolean =>
    v === undefined || (typeof v === 'object' && v !== null && Object.values(v).some(hasUndefined))

  it('is marked as being written down, with the language if one was chosen, and stamps when this attempt started', () => {
    expect(markTranscribing(spoken, 'c9', undefined, { now: NOW }).comments?.[0].recording).toEqual({ ...rec, status: 'transcribing', startedAt: NOW })
    expect(markTranscribing(spoken, 'c9', 'fr', { now: NOW }).comments?.[0].recording).toEqual({ ...rec, status: 'transcribing', language: 'fr', startedAt: NOW })
  })

  it('lands as the message text, and the state goes away', () => {
    const done = setReactionTranscript(markTranscribing(spoken, 'c9', undefined, { now: NOW }), 'c9', '  bonjour, you look happy  ')
    expect(done.comments?.[0]).toMatchObject({ text: 'bonjour, you look happy', recording: rec })
    expect(done.comments?.[0].recording).not.toHaveProperty('status')
    expect(done.comments?.[0].recording).not.toHaveProperty('startedAt')
    expect(hasUndefined(done)).toBe(false)
  })

  it('nothing heard is a failure with a reason, never a blank message', () => {
    const none = setReactionTranscript(spoken, 'c9', '   ')
    expect(none.comments?.[0].recording).toEqual({ ...rec, status: 'failed', reason: 'nothing was heard in that recording' })
    expect(none.comments?.[0].text).toBe('')
  })

  it('a no-speech answer (empty after transcribeSpeech maps the sentinel) ends failed with the nothing-heard reason', () => {
    const none = setReactionTranscript(markTranscribing(spoken, 'c9', undefined, { now: NOW }), 'c9', '')
    expect(none.comments?.[0].recording).toEqual({ ...rec, status: 'failed', reason: NOTHING_HEARD })
  })

  it('a failure keeps the voice and says why; a retry clears the old reason and reason, and stamps a fresh start', () => {
    const failed = failReactionTranscript(spoken, 'c9', 'the recording could not be made out')
    expect(failed.comments?.[0].recording).toEqual({ ...rec, status: 'failed', reason: 'the recording could not be made out' })
    expect(markTranscribing(failed, 'c9', undefined, { now: NOW }).comments?.[0].recording).toEqual({ ...rec, status: 'transcribing', startedAt: NOW })
    expect(hasUndefined(markTranscribing(failed, 'c9', undefined, { now: NOW }))).toBe(false)
  })

  it('a very long transcript is kept to the message limit', () => {
    expect(setReactionTranscript(spoken, 'c9', 'x'.repeat(MESSAGE_MAX + 50)).comments?.[0].text).toHaveLength(MESSAGE_MAX)
  })

  it('refuses a message that has no recording', () => {
    const typed = applySnapPatch(snap(), 'ana', { kind: 'comment', text: 'hi' }, { now: NOW, id: 'c1' })
    expect(() => markTranscribing(typed, 'c1')).toThrow(RuleError)
    expect(() => markTranscribing(typed, 'nope')).toThrow(RuleError)
  })

  it('an auto transcription may only run while the recording is still exactly as attached: transcribing', () => {
    expect(canAutoTranscribe({ ...rec, status: 'transcribing' })).toBe(true)
    expect(canAutoTranscribe({ ...rec, status: 'failed', reason: 'x' })).toBe(false)
    expect(canAutoTranscribe(rec)).toBe(false) // settled: no status at all means already done
  })

  it('Try again is allowed from failed or done, refused while a live transcription is still young, and recovers a stale one', () => {
    const at = '2026-09-27T20:00:00.000Z'
    const fresh = '2026-09-27T20:02:00.000Z' // 2 minutes later
    const stale = '2026-09-27T20:06:00.000Z' // 6 minutes later
    expect(canRetranscribe({ ...rec, status: 'failed', reason: 'x' }, at, fresh)).toBe(true)
    expect(canRetranscribe(rec, at, fresh)).toBe(true) // no status: a finished transcript
    // No startedAt (a recording filed before the field existed): falls back to the comment's `at`.
    expect(canRetranscribe({ ...rec, status: 'transcribing' }, at, fresh)).toBe(false)
    expect(canRetranscribe({ ...rec, status: 'transcribing' }, at, stale)).toBe(true)
  })

  it('with startedAt present, staleness is measured from the attempt, not the comment', () => {
    const oldComment = '2026-09-27T10:00:00.000Z' // hours before "now": the fallback would wrongly allow this
    const now = '2026-09-27T20:02:00.000Z'
    // Old comment, but the transcription itself only just started: still a live job, refused.
    expect(canRetranscribe({ ...rec, status: 'transcribing', startedAt: '2026-09-27T20:00:00.000Z' }, oldComment, now)).toBe(false)
    // Old comment, and the attempt itself is more than 5 minutes old: recoverable.
    expect(canRetranscribe({ ...rec, status: 'transcribing', startedAt: '2026-09-27T19:50:00.000Z' }, oldComment, now)).toBe(true)
  })
})
