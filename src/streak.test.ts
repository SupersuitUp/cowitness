import { describe, expect, it } from 'vitest'
import { captureStreak, householdStreakOf, streakOf, streaksOf } from './streak.js'
import type { SnapRow } from './format.js'

// Local noon on a given day, so the tests read the same in any time zone the suite runs in.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()
const NOW = new Date(2026, 8, 27, 18) // Sunday 27 September 2026, 6pm local

const row = (by: 'ana' | 'ben', createdAt: string, hidden = false): SnapRow => ({
  id: createdAt + by, by, caption: '', kind: 'photo', thumbUrl: null, durationSec: null,
  createdAt, witnessedAt: null, hidden,
})

describe('streakOf', () => {
  it('is nothing with no snaps', () => {
    expect(streakOf([], NOW)).toEqual({ count: 0, postedToday: false })
  })
  it('counts consecutive days ending today', () => {
    expect(streakOf([at(2026, 9, 27), at(2026, 9, 26), at(2026, 9, 25)], NOW)).toEqual({ count: 3, postedToday: true })
  })
  it('counts several snaps on one day once', () => {
    expect(streakOf([at(2026, 9, 27, 9), at(2026, 9, 27, 17), at(2026, 9, 26)], NOW)).toEqual({ count: 2, postedToday: true })
  })
  it('stays alive through today when the last snap was yesterday, and says today is still owed', () => {
    expect(streakOf([at(2026, 9, 26), at(2026, 9, 25)], NOW)).toEqual({ count: 2, postedToday: false })
  })
  it('is broken by a missed day', () => {
    expect(streakOf([at(2026, 9, 25), at(2026, 9, 24)], NOW)).toEqual({ count: 0, postedToday: false })
  })
  it('stops counting at the first gap', () => {
    expect(streakOf([at(2026, 9, 27), at(2026, 9, 26), at(2026, 9, 24), at(2026, 9, 23)], NOW)).toEqual({ count: 2, postedToday: true })
  })
  it('uses the local calendar day, so a snap just after midnight is today', () => {
    expect(streakOf([at(2026, 9, 27, 0), at(2026, 9, 26, 23)], NOW)).toEqual({ count: 2, postedToday: true })
  })
})

describe('streaksOf', () => {
  it('gives each member their own streak and a together streak for days you both shared', () => {
    const rows = [
      row('ana', at(2026, 9, 27)), row('ana', at(2026, 9, 26)), row('ana', at(2026, 9, 25)),
      row('ben', at(2026, 9, 26)), row('ben', at(2026, 9, 25)), row('ben', at(2026, 9, 24)),
    ]
    expect(streaksOf(rows, NOW, ['ana', 'ben'])).toEqual({
      ana: { count: 3, postedToday: true },
      ben: { count: 3, postedToday: false },
      together: { count: 2, postedToday: false },
    })
  })
  it('does not count a hidden snap, so both of you see the same number', () => {
    const rows = [row('ana', at(2026, 9, 27), true), row('ana', at(2026, 9, 26))]
    expect(streaksOf(rows, NOW, ['ana', 'ben']).ana).toEqual({ count: 1, postedToday: false })
  })
})

describe('the household streak', () => {
  const days = (...ks: string[]) => new Set(ks)
  const SINCE = '2026-09-01'
  it('counts consecutive days ending today, and owes today rather than breaking on it', () => {
    expect(captureStreak(days('2026-09-29', '2026-09-30', '2026-10-01'), '2026-10-01', SINCE, 1)).toMatchObject({ count: 3, capturedToday: true })
    expect(captureStreak(days('2026-09-29', '2026-09-30'), '2026-10-01', SINCE, 1)).toMatchObject({ count: 2, capturedToday: false, skipUsedThisWeek: false })
  })
  it('forgives one missed day a week', () => {
    expect(captureStreak(days('2026-10-01', '2026-09-29', '2026-09-28', '2026-09-27'), '2026-10-01', SINCE, 1))
      .toEqual({ count: 4, capturedToday: true, skipUsedThisWeek: true })
  })
  it('breaks on a second missed day in one week, and on any missed day with no free skip', () => {
    expect(captureStreak(days('2026-10-01', '2026-09-28'), '2026-10-01', SINCE, 1).count).toBe(1)
    expect(captureStreak(days('2026-10-01', '2026-09-29'), '2026-10-01', SINCE, 0).count).toBe(1)
  })
  it('never counts before the start date, and is zero with nothing shared', () => {
    expect(captureStreak(days('2026-09-29', '2026-09-30', '2026-10-01'), '2026-10-01', '2026-09-29', 1).count).toBe(3)
    expect(captureStreak(days(), '2026-10-01', SINCE, 1).count).toBe(0)
  })
  it('reads each snap\'s day in the rule\'s zone and leaves out what is hidden', () => {
    const r = (createdAt: string, hidden = false) => ({ id: createdAt, by: 'ana', caption: '', kind: 'photo' as const, thumbUrl: null, durationSec: null, createdAt, witnessedAt: null, hidden })
    const rule = { kind: 'household' as const, timeZone: 'America/Los_Angeles', since: SINCE, freeSkipsPerWeek: 1 as const }
    // Early morning in UTC is still the evening before in that zone, so today is owed, not missed.
    const now = new Date('2026-10-01T06:30:00Z')
    expect(householdStreakOf([r('2026-09-30T20:00:00Z'), r('2026-09-29T20:00:00Z')], now, rule)).toMatchObject({ count: 2, capturedToday: true })
    expect(householdStreakOf([r('2026-09-30T20:00:00Z', true)], now, rule).count).toBe(0)
  })
  it('counts a snap shared just after local midnight on the clock-change day in that day', () => {
    const r = (createdAt: string) => ({ id: createdAt, by: 'ana', caption: '', kind: 'photo' as const, thumbUrl: null, durationSec: null, createdAt, witnessedAt: null, hidden: false })
    const rule = { kind: 'household' as const, timeZone: 'America/Los_Angeles', since: SINCE, freeSkipsPerWeek: 0 as const }
    // The zone falls back this weekend: three snaps on three local days, 07:30 UTC being 00:30 local before and 23:30 local after.
    const rows = [r('2026-10-31T07:30:00Z'), r('2026-11-01T08:30:00Z'), r('2026-11-02T08:30:00Z')]
    expect(householdStreakOf(rows, new Date('2026-11-02T20:00:00Z'), rule)).toMatchObject({ count: 3, capturedToday: true })
  })
})
