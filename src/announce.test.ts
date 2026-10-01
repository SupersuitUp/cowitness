import { describe, expect, it } from 'vitest'
import { announcementOf } from './announce.js'
import type { Snap } from './types.js'

const NOW = '2026-09-30T12:00:00.000Z'
const snap = (o: Partial<Snap> = {}): Snap => ({
  id: 's1', by: 'ben', caption: '', kind: 'photo', takenAt: 'x', width: 1, height: 1,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null, createdAt: 'x', ...o,
})

describe('what a write tells the others', () => {
  it('a message is news when its writer sent it', () => {
    const s = snap({ comments: [{ id: 'c1', by: 'ana', text: 'hi', at: NOW }] })
    expect(announcementOf('ana', s, { kind: 'comment', text: 'hi' }, NOW)).toEqual({ kind: 'message', comment: s.comments![0] })
    expect(announcementOf('ben', s, { kind: 'comment', text: 'hi' }, NOW)).toBeNull()
    expect(announcementOf('ana', snap(), { kind: 'comment', text: 'hi' }, NOW)).toBeNull()
  })
  it('a heart is news only the first time, stamped by this request', () => {
    const fresh = snap({ comments: [{ id: 'c1', by: 'ben', text: 'hi', at: 'x', hearts: { ana: NOW } }] })
    expect(announcementOf('ana', fresh, { kind: 'comment-heart', commentId: 'c1', value: true }, NOW)).toEqual({ kind: 'heart', comment: fresh.comments![0] })
    const old = snap({ comments: [{ id: 'c1', by: 'ben', text: 'hi', at: 'x', hearts: { ana: '2026-09-29T00:00:00.000Z' } }] })
    expect(announcementOf('ana', old, { kind: 'comment-heart', commentId: 'c1', value: true }, NOW)).toBeNull()
    expect(announcementOf('ana', fresh, { kind: 'comment-heart', commentId: 'c1', value: false }, NOW)).toBeNull()
  })
  it('witnessing is news only for the request that set the stamp, with the typed words', () => {
    expect(announcementOf('ana', snap({ witnessedAt: NOW }), { kind: 'witness', text: '  so good ' }, NOW)).toEqual({ kind: 'witnessed', firstWords: 'so good' })
    expect(announcementOf('ana', snap({ witnessedAt: NOW }), { kind: 'witness' }, NOW)).toEqual({ kind: 'witnessed', firstWords: '' })
    expect(announcementOf('ana', snap({ witnessedAt: '2026-09-29T00:00:00.000Z' }), { kind: 'witness' }, NOW)).toBeNull()
  })
  it('hiding and bringing back are never news', () => {
    expect(announcementOf('ben', snap({ hiddenAt: NOW }), { kind: 'hide' }, NOW)).toBeNull()
    expect(announcementOf('ben', snap(), { kind: 'unhide' }, NOW)).toBeNull()
  })
})
