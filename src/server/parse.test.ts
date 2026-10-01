import { describe, it, expect } from 'vitest'
import { parseSnapPhotoBody, parseSnapVideoBody, parseSnapPatch } from './parse.js'
import { RuleError } from '../shared-rules.js'

describe('snap request bodies', () => {
  it('a photo snap needs its upload id; the caption and time are optional', () => {
    expect(parseSnapPhotoBody({ photoId: 'p1' })).toEqual({ photoId: 'p1', caption: undefined, clientTakenAt: undefined })
    expect(parseSnapPhotoBody({ photoId: 'p1', caption: 'hi', clientTakenAt: '2026-09-27T20:00:00.000Z' })).toEqual({ photoId: 'p1', caption: 'hi', clientTakenAt: '2026-09-27T20:00:00.000Z' })
    expect(() => parseSnapPhotoBody({})).toThrow(RuleError)
  })

  it('a video snap needs its id and real dimensions; a UTC time is refused', () => {
    const ok = { photoId: 'v1', durationSec: 8.2, width: 1080, height: 1920 }
    expect(parseSnapVideoBody({ ...ok, caption: 'run', takenAt: '2026-09-27T14:03:00' })).toEqual({
      photoId: 'v1', caption: 'run', meta: { durationSec: 8.2, width: 1080, height: 1920, takenAt: '2026-09-27T14:03:00' },
    })
    for (const bad of [{ ...ok, photoId: '' }, { ...ok, durationSec: 0 }, { ...ok, width: 1.5 }, { ...ok, takenAt: '2026-09-27T19:03:00Z' }]) {
      expect(() => parseSnapVideoBody(bad)).toThrow(RuleError)
    }
  })

  it('a patch is a message, a heart on a message, hide or unhide, and nothing else', () => {
    expect(parseSnapPatch({ kind: 'comment', text: 'amen' })).toEqual({ kind: 'comment', text: 'amen' })
    expect(parseSnapPatch({ kind: 'comment-heart', commentId: 'c1', value: true })).toEqual({ kind: 'comment-heart', commentId: 'c1', value: true })
    expect(parseSnapPatch({ kind: 'hide' })).toEqual({ kind: 'hide' })
    expect(parseSnapPatch({ kind: 'unhide' })).toEqual({ kind: 'unhide' })
    expect(() => parseSnapPatch({ kind: 'comment', text: 3 })).toThrow(RuleError)
    expect(() => parseSnapPatch({ kind: 'delete' })).toThrow(RuleError)
  })

  it('a witness patch may carry typed words, and only text', () => {
    expect(parseSnapPatch({ kind: 'witness' })).toEqual({ kind: 'witness' })
    expect(parseSnapPatch({ kind: 'witness', text: 'so good' })).toEqual({ kind: 'witness', text: 'so good' })
    expect(() => parseSnapPatch({ kind: 'witness', text: 5 })).toThrow(RuleError)
  })
})
