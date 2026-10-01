import { describe, expect, it } from 'vitest'
import {
  MESSAGE_MAX, NOTHING_HEARD, RuleError, addComment, audioExtension, heartComment, lastMessageFromOther, localTakenAt,
  messageSummary, parseCommentBody, parseCommentHeart, threadOf, validateClip, validateCommentImages, validateVideoDims,
} from './shared-rules.js'
import type { Comment } from './types.js'

const NOW = '2026-09-30T12:00:00.000Z'
const c = (o: Partial<Comment>): Comment => ({ id: 'c1', by: 'ben', text: 'hi', at: '2026-09-30T10:00:00.000Z', ...o })

describe('a message', () => {
  it('is appended under its author, stamped and trimmed', () => {
    const p = addComment({ comments: [c({})] }, 'ana', '  hello  ', { now: NOW, id: 'c2' })
    expect(p.comments?.at(-1)).toEqual({ id: 'c2', by: 'ana', text: 'hello', at: NOW })
  })
  it('may be pictures alone, never nothing and never too long', () => {
    const pics = addComment({}, 'ana', '', { now: NOW, id: 'c3', images: [{ id: 'img1', width: 10, height: 20 }] })
    expect(pics.comments?.[0]).toEqual({ id: 'c3', by: 'ana', text: '', at: NOW, images: [{ id: 'img1', width: 10, height: 20 }] })
    expect(() => addComment({}, 'ana', '   ')).toThrow('message is empty')
    expect(() => addComment({}, 'ana', 'x'.repeat(MESSAGE_MAX + 1))).toThrow('message too long')
  })
  it('gets an id of its own when none is given', () => {
    expect(addComment({}, 'ana', 'x').comments?.[0].id).toMatch(/^c-/)
  })
  it('carries at most four pictures, each with a safe id and a real size', () => {
    expect(validateCommentImages(undefined)).toBeUndefined()
    expect(() => validateCommentImages([1, 2, 3, 4, 5].map((i) => ({ id: `i${i}`, width: 1, height: 1 })))).toThrow(RuleError)
    expect(() => validateCommentImages([{ id: '../x', width: 1, height: 1 }])).toThrow('bad picture id')
    expect(() => validateCommentImages([{ id: 'a', width: 1.5, height: 1 }])).toThrow('bad picture size')
    expect(() => validateCommentImages([{ id: 'a', width: 1, height: 1 }, { id: 'a', width: 1, height: 1 }])).toThrow('the same picture twice')
  })
})

describe('a heart', () => {
  it('comes from someone who did not write the message, stamped once', () => {
    const once = heartComment({ comments: [c({})] }, 'ana', 'c1', true, { now: NOW })
    expect(once.comments?.[0].hearts).toEqual({ ana: NOW })
    const again = heartComment(once, 'ana', 'c1', true, { now: '2026-10-01T00:00:00.000Z' })
    expect(again.comments?.[0].hearts).toEqual({ ana: NOW })
    expect(heartComment(again, 'ana', 'c1', false).comments?.[0].hearts).toEqual({})
  })
  it('never on your own message or on one that is not there', () => {
    expect(() => heartComment({ comments: [c({})] }, 'ben', 'c1', true)).toThrow('you cannot heart your own message')
    expect(() => heartComment({ comments: [c({})] }, 'ana', 'nope', true)).toThrow('message not found')
  })
})

describe('the conversation', () => {
  it('reads in time order, and knows the newest message from anyone else', () => {
    const p = { comments: [c({ id: 'b', at: '2026-09-30T11:00:00.000Z' }), c({ id: 'a', by: 'ana', at: '2026-09-30T09:00:00.000Z' }), c({ id: 'z', at: '2026-09-30T10:00:00.000Z' })] }
    expect(threadOf(p).map((x) => x.id)).toEqual(['a', 'z', 'b'])
    expect(lastMessageFromOther(p, 'ana')).toBe('2026-09-30T11:00:00.000Z')
    expect(lastMessageFromOther(p, 'ben')).toBe('2026-09-30T09:00:00.000Z')
    expect(lastMessageFromOther({}, 'ana')).toBeUndefined()
  })
  it('summarises a message as its words, or what it holds', () => {
    expect(messageSummary({ text: 'hi' })).toBe('hi')
    expect(messageSummary({ text: '', images: [{ id: 'a', width: 1, height: 1 }] })).toBe('a photo')
    expect(messageSummary({ text: '', images: [{ id: 'a', width: 1, height: 1 }, { id: 'b', width: 1, height: 1 }] })).toBe('2 photos')
    expect(messageSummary({ text: '' })).toBe('')
  })
  it('parses a send and a heart, and nothing malformed', () => {
    expect(parseCommentBody({ text: 'x' })).toEqual({ kind: 'comment', text: 'x' })
    expect(() => parseCommentBody({ text: 3 })).toThrow(RuleError)
    expect(parseCommentHeart({ commentId: 'c1', value: false })).toEqual({ kind: 'comment-heart', commentId: 'c1', value: false })
    expect(() => parseCommentHeart({ commentId: '', value: true })).toThrow(RuleError)
  })
})

describe('recordings and video fields', () => {
  it('takes the audio types a phone records, within the size and length caps', () => {
    expect(validateClip({ contentType: 'audio/webm;codecs=opus', size: 10, durationSec: 3 })).toEqual({ contentType: 'audio/webm', size: 10, durationSec: 3 })
    expect(() => validateClip({ contentType: 'audio/flac', size: 10, durationSec: 3 })).toThrow('unsupported audio type')
    expect(() => validateClip({ contentType: 'audio/mp4', size: 0, durationSec: 3 })).toThrow('recording is too large')
    expect(audioExtension('audio/mp4')).toBe('m4a')
    expect(audioExtension('audio/unknown')).toBe('bin')
    expect(NOTHING_HEARD).toBe('nothing was heard in that recording')
  })
  it('takes local wall-clock times only, and real video dimensions', () => {
    expect(localTakenAt('2026-09-27T14:03:00+02:00')).toBe('2026-09-27T14:03:00')
    expect(localTakenAt(undefined)).toBeUndefined()
    expect(() => localTakenAt('2026-09-27T14:03:00Z')).toThrow('send local time')
    expect(() => localTakenAt('2026-02-30T10:00:00')).toThrow(RuleError)
    expect(validateVideoDims({ durationSec: 8.2, width: 1080, height: 1920 })).toEqual({ durationSec: 8.2, width: 1080, height: 1920 })
    expect(() => validateVideoDims({ durationSec: 0, width: 1, height: 1 })).toThrow(RuleError)
  })
})
