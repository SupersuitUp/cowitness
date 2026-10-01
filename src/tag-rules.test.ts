import { describe, expect, it } from 'vitest'
import { circleOf } from './features.js'
import { applySnapPatch, newSnap } from './snap-rules.js'
import { tagsToAnnounce, validateJustUs, validateTags } from './tag-rules.js'
import type { FiledMedia, Snap } from './types.js'

const VALID = new Set(['t-first', 't-second'])
const MEDIA: FiledMedia = { kind: 'photo', takenAt: 'x', width: 1, height: 1, paths: { original: 'o', display: 'd', thumb: 't' } }
const NOW = '2026-09-30T12:00:00.000Z'
const AUD = circleOf('audience', [{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'shares' }, { key: 'cy', role: 'witnesses' }])
const snap = (o: Partial<Snap> = {}): Snap => ({ id: 's1', ...newSnap('ana', MEDIA, '', NOW), ...o })

describe('validateTags', () => {
  it('takes known ids, once each, up to the cap; an empty list is no tags', () => {
    expect(validateTags(['t-first', 't-first'], VALID, 1)).toEqual(['t-first'])
    expect(validateTags([], VALID, 1)).toBeUndefined()
    expect(validateTags(undefined, undefined, 1)).toBeUndefined()
  })
  it('refuses tags where they are off, unknown ids, too many, and anything not a list of ids', () => {
    expect(() => validateTags(['t-first'], undefined, 1)).toThrow(/not on here/)
    expect(() => validateTags(['nope'], VALID, 1)).toThrow(/unknown tag/)
    expect(() => validateTags(['t-first', 't-second'], VALID, 1)).toThrow(/at most 1 tag/)
    expect(() => validateTags('t-first', VALID, 1)).toThrow(/list/)
  })
})

describe('validateJustUs', () => {
  it('is true, or absent; false and nothing are absent', () => {
    expect(validateJustUs(true, true)).toBe(true)
    expect(validateJustUs(false, true)).toBeUndefined()
    expect(validateJustUs(undefined, false)).toBeUndefined()
  })
  it('refuses it where it is off, and anything not a boolean', () => {
    expect(() => validateJustUs(true, false)).toThrow(/not on here/)
    expect(() => validateJustUs('yes', true)).toThrow(/true or false/)
  })
})

describe('a new snap', () => {
  it('stores no new field unless one was given', () => {
    expect(Object.keys(newSnap('ana', MEDIA, '', NOW)).sort()).toEqual(['by', 'caption', 'createdAt', 'height', 'hiddenAt', 'kind', 'paths', 'takenAt', 'width', 'witnessedAt'])
    expect(newSnap('ana', MEDIA, '', NOW, { justUs: true, tags: ['t-first'] })).toMatchObject({ justUs: true, tags: ['t-first'] })
  })
})

describe('the tag patch', () => {
  it('sets, replaces and clears the tags; anyone who shares may, in the audience kind', () => {
    const tagged = applySnapPatch(snap(), 'ben', { kind: 'tag', ids: ['t-second'] }, { now: NOW, ctx: AUD, tags: VALID })
    expect(tagged.tags).toEqual(['t-second'])
    expect('tags' in applySnapPatch(tagged, 'ana', { kind: 'tag', ids: [] }, { now: NOW, ctx: AUD, tags: VALID })).toBe(false)
  })
  it('is the sharer\'s alone in the each-other kind, never a witness\'s, and refused where tags are off', () => {
    expect(() => applySnapPatch(snap(), 'ben', { kind: 'tag', ids: ['t-first'] }, { now: NOW, tags: VALID })).toThrow(/only someone who shares/)
    expect(() => applySnapPatch(snap(), 'cy', { kind: 'tag', ids: ['t-first'] }, { now: NOW, ctx: AUD, tags: VALID })).toThrow(/only someone who shares/)
    expect(() => applySnapPatch(snap(), 'ana', { kind: 'tag', ids: ['t-first'] }, { now: NOW })).toThrow(/not on here/)
  })
})

describe('the "just us" patch', () => {
  it('is the sharer\'s alone, sets true and removes the key when turned off', () => {
    const secret = applySnapPatch(snap(), 'ana', { kind: 'just-us', value: true }, { now: NOW, ctx: AUD, justUs: true })
    expect(secret.justUs).toBe(true)
    expect('justUs' in applySnapPatch(secret, 'ana', { kind: 'just-us', value: false }, { now: NOW, ctx: AUD, justUs: true })).toBe(false)
    expect(() => applySnapPatch(snap(), 'ben', { kind: 'just-us', value: true }, { now: NOW, ctx: AUD, justUs: true })).toThrow(/person who shared it/)
    expect(() => applySnapPatch(snap(), 'ana', { kind: 'just-us', value: true }, { now: NOW })).toThrow(/not on here/)
  })
})

describe('tagsToAnnounce (the caller announces tagged only when this returns a list)', () => {
  it('is the new set when it changed and is not empty', () => {
    expect(tagsToAnnounce(snap(), snap({ tags: ['t-first'] }))).toEqual(['t-first'])
    expect(tagsToAnnounce(snap({ tags: ['t-first'] }), snap({ tags: ['t-second'] }))).toEqual(['t-second'])
  })
  it('is nothing for the same set again, a cleared set, or no tags at all', () => {
    expect(tagsToAnnounce(snap({ tags: ['t-first'] }), snap({ tags: ['t-first'] }))).toBeUndefined()
    expect(tagsToAnnounce(snap({ tags: ['t-first'] }), snap())).toBeUndefined()
    expect(tagsToAnnounce(snap(), snap())).toBeUndefined()
  })
})
