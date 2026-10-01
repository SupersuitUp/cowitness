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

describe('the option fields', () => {
  it('passes justUs and tags through only when the body carries them', () => {
    expect(Object.keys(parseSnapPhotoBody({ photoId: 'p1' })).sort()).toEqual(['caption', 'clientTakenAt', 'photoId'])
    expect(Object.keys(parseSnapVideoBody({ photoId: 'v1', durationSec: 1, width: 1, height: 1 })).sort()).toEqual(['caption', 'meta', 'photoId'])
    expect(parseSnapPhotoBody({ photoId: 'p1', justUs: true, tags: ['t-first'] })).toMatchObject({ justUs: true, tags: ['t-first'] })
    expect(parseSnapVideoBody({ photoId: 'v1', durationSec: 1, width: 1, height: 1, tags: [] })).toMatchObject({ tags: [] })
  })
  it('reads the two new patches where their option is on', () => {
    const on = { tags: true, justUs: true }
    expect(parseSnapPatch({ kind: 'tag', ids: ['t-first'] }, on)).toEqual({ kind: 'tag', ids: ['t-first'] })
    expect(parseSnapPatch({ kind: 'just-us', value: false }, on)).toEqual({ kind: 'just-us', value: false })
    expect(() => parseSnapPatch({ kind: 'tag', ids: 't-first' }, on)).toThrow(/ids must be a list/)
    expect(() => parseSnapPatch({ kind: 'just-us', value: 'yes' }, on)).toThrow(/value must be a boolean/)
  })
  it('refuses them with the words it always used where their option is off', () => {
    expect(() => parseSnapPatch({ kind: 'tag', ids: [] })).toThrow(/unknown patch kind/)
    expect(() => parseSnapPatch({ kind: 'just-us', value: true }, { tags: true })).toThrow(/unknown patch kind/)
  })
})
