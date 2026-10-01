import { describe, expect, it } from 'vitest'
import { streakOf, streaksOf } from './streak.js'
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
