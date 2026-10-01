import { describe, expect, it } from 'vitest'
import { circleOf } from './features.js'
import { announcementOf } from './announce.js'
import {
  applySnapPatch, archiveOf, assertCanShare, canSeeSnap, coverOf, cowitnessTile, mayHear, openOf, queueOf, seenBy, snapHasNew, witnessedOf,
} from './snap-rules.js'
import type { Snap } from './types.js'

// ana and ben share; cy only witnesses. In the each-other kind nothing here applies.
const AUD = circleOf('audience', [{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'shares' }, { key: 'cy', role: 'witnesses' }])
const s = (id: string, by: string, o: Partial<Snap> = {}): Snap => ({
  id, by, caption: '', kind: 'photo', takenAt: 'x', width: 1, height: 1, paths: { original: 'o', display: 'd', thumb: 't' },
  witnessedAt: null, hiddenAt: null, createdAt: `2026-09-30T0${id.slice(1)}:00:00.000Z`, ...o,
})
const NOW = '2026-09-30T12:00:00.000Z'

describe('"just us"', () => {
  it('is seen by the people who share and nobody else', () => {
    const secret = s('s1', 'ana', { justUs: true })
    expect(canSeeSnap(secret, 'ben', AUD)).toBe(true)
    expect(canSeeSnap(secret, 'cy', AUD)).toBe(false)
    expect(archiveOf([secret, s('s2', 'ana')], 'cy', AUD).map((x) => x.id)).toEqual(['s2'])
    expect(queueOf([secret], 'cy', AUD)).toEqual([])
  })
  it('stays private to its author when a rule is given no circle (the option was turned off), on every read', () => {
    const secret = s('s1', 'ana', { justUs: true, witnessedAt: NOW })
    for (const m of ['ben', 'cy']) {
      expect(canSeeSnap(secret, m)).toBe(false)
      expect(archiveOf([secret], m)).toEqual([])
      expect(openOf([secret], m)).toEqual([])
      expect(witnessedOf([secret], m)).toEqual([])
      expect(queueOf([s('s2', 'ana', { justUs: true })], m)).toEqual([])
      expect(coverOf([secret], m)).toBeNull()
      expect(snapHasNew(secret, m, '2000-01-01T00:00:00.000Z')).toBe(false)
      expect(cowitnessTile([secret], m, '2000-01-01T00:00:00.000Z', null)).toEqual({ count: 0, coverUrl: null, hasNew: false, waiting: 0 })
    }
    expect(canSeeSnap(secret, 'ana')).toBe(true)
  })
  it('is always seen by its author, even one the circle no longer counts as sharing', () => {
    expect(canSeeSnap(s('s1', 'cy', { justUs: true }), 'cy', AUD)).toBe(true)
    expect(applySnapPatch(s('s1', 'cy', { justUs: true }), 'cy', { kind: 'just-us', value: false }, { now: NOW, ctx: AUD, justUs: true })).not.toHaveProperty('justUs')
  })
  it('is a snap a host may announce only to the people who share, and with no circle only to its author', () => {
    const secret = s('s1', 'ana', { justUs: true })
    expect(['ana', 'ben', 'cy'].map((m) => mayHear(secret, m, AUD))).toEqual([true, true, false])
    expect(['ana', 'ben', 'cy'].map((m) => mayHear(secret, m))).toEqual([true, false, false])
    expect(['ana', 'ben', 'cy'].map((m) => mayHear(s('s2', 'ana'), m))).toEqual([true, true, true])
    expect(['ana', 'ben', 'cy'].map((m) => mayHear(s('s3', 'ana', { hiddenAt: NOW }), m, AUD))).toEqual([true, false, false])
  })
  it('refuses a witness who cannot see it, as though it did not exist', () => {
    expect(() => applySnapPatch(s('s1', 'ana', { justUs: true }), 'cy', { kind: 'witness' }, { now: NOW, ctx: AUD })).toThrow(/hidden/)
  })
})

describe('the audience kind', () => {
  it('gives a queue only to people who witness, oldest first, without their own and without what they saw', () => {
    const all = [s('s2', 'ana'), s('s1', 'ben'), s('s3', 'ana', { witnessedBy: { cy: NOW } }), s('s4', 'ana', { hiddenAt: NOW })]
    expect(queueOf(all, 'cy', AUD).map((x) => x.id)).toEqual(['s1', 's2'])
    expect(queueOf(all, 'ana', AUD)).toEqual([])
  })
  it('keeps one seen per witness, and the first seen as the snap\'s own receipt', () => {
    const once = applySnapPatch(s('s1', 'ana'), 'cy', { kind: 'witness', text: ' so sweet ' }, { now: NOW, ctx: AUD })
    expect(once.witnessedBy).toEqual({ cy: NOW })
    expect(once.witnessedAt).toBe(NOW)
    expect(once.comments?.[0]).toMatchObject({ by: 'cy', text: 'so sweet' })
    const twice = applySnapPatch(once, 'cy', { kind: 'witness' }, { now: '2026-09-30T13:00:00.000Z', ctx: AUD })
    expect(twice.witnessedBy).toEqual({ cy: NOW })
  })
  it('refuses a witness from someone who only shares, and from the person who shared it', () => {
    expect(() => applySnapPatch(s('s1', 'ana'), 'ben', { kind: 'witness' }, { now: NOW, ctx: AUD })).toThrow(/only someone who witnesses/)
    expect(() => applySnapPatch(s('s1', 'cy'), 'cy', { kind: 'witness' }, { now: NOW, ctx: AUD })).toThrow(/your own/)
  })
  it('opens and shelves per person: a witness by their own seen, the sharer by the first', () => {
    const all = [s('s1', 'ana', { witnessedBy: { cy: NOW }, witnessedAt: NOW }), s('s2', 'ana')]
    expect(seenBy(all[0], 'cy', AUD)).toBe(true)
    expect(openOf(all, 'cy', AUD).map((x) => x.id)).toEqual(['s2'])
    expect(witnessedOf(all, 'ana', AUD).map((x) => x.id)).toEqual(['s1'])
  })
  it('lets a person who only shares read the first seen, so the other sharer\'s moments leave their Today once witnessed', () => {
    const all = [s('s1', 'ana', { witnessedBy: { cy: NOW }, witnessedAt: NOW }), s('s2', 'ana')]
    expect(seenBy(all[0], 'ben', AUD)).toBe(true)
    expect(openOf(all, 'ben', AUD).map((x) => x.id)).toEqual(['s2'])
    expect(witnessedOf(all, 'ben', AUD).map((x) => x.id)).toEqual(['s1'])
  })
  it('counts the tile\'s waiting from the person\'s own queue', () => {
    expect(cowitnessTile([s('s1', 'ana'), s('s2', 'ana', { witnessedBy: { cy: NOW } })], 'cy', NOW, null, AUD).waiting).toBe(1)
  })
  it('lets only the people who share add a snap', () => {
    expect(() => assertCanShare('cy', AUD)).toThrow(/cannot share/)
    expect(() => assertCanShare('ana', AUD)).not.toThrow()
    expect(() => assertCanShare('cy')).not.toThrow()
  })
  it('announces a witness once per person, at the stamp this request set', () => {
    const seen = applySnapPatch(s('s1', 'ana', { witnessedAt: '2026-09-30T09:00:00.000Z', witnessedBy: { ben: '2026-09-30T09:00:00.000Z' } }), 'cy', { kind: 'witness' }, { now: NOW, ctx: AUD })
    expect(announcementOf('cy', seen, { kind: 'witness' }, NOW, 'audience')).toEqual({ kind: 'witnessed', firstWords: '' })
    expect(announcementOf('cy', seen, { kind: 'witness' }, '2026-09-30T13:00:00.000Z', 'audience')).toBeNull()
  })
})
