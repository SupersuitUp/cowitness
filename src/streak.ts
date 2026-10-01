// Streaks: how many days in a row someone has shared a snap. Pure, and computed on the phone,
// because a "day" is the viewer's local calendar day and the server does not know the phone's
// zone. The member keys are passed in rather
// than read from the app's own list of people, and "together" is the days every one shared.
import type { SnapRow } from './format.js'
import type { HouseholdStreakRule } from './features.js'
import { addDays, weekStart, zoned } from './zoned.js'

export interface Streak { count: number; postedToday: boolean }
export type Streaks = Record<string, Streak> & { together: Streak }

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

function previousDay(d: Date): Date {
  const p = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  p.setDate(p.getDate() - 1)
  return p
}

// A streak is alive through today if the last snap was yesterday: today is owed, not missed yet.
function countFrom(days: Set<string>, now: Date): Streak {
  const postedToday = days.has(dayKey(now))
  let d = postedToday ? now : previousDay(now)
  let count = 0
  while (days.has(dayKey(d))) { count++; d = previousDay(d) }
  return { count, postedToday }
}

const daysOf = (isoTimes: string[]) => new Set(isoTimes.map((t) => dayKey(new Date(t))))

export function streakOf(isoTimes: string[], now = new Date()): Streak {
  return countFrom(daysOf(isoTimes), now)
}

// A hidden snap is left out, so the number is the same on every phone: the others cannot see it.
export function streaksOf(rows: SnapRow[], now: Date, keys: readonly string[]): Streaks {
  const shared = rows.filter((r) => !r.hidden)
  const sets = keys.map((m) => daysOf(shared.filter((r) => r.by === m).map((r) => r.createdAt)))
  const together = new Set([...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))))
  const out = { together: countFrom(together, now) } as Streaks
  keys.forEach((m, i) => { out[m] = countFrom(sets[i], now) })
  return out
}

// One count for everyone who shares. A day counts when anything was shared that day, in the rule's
// time zone. A missed day breaks it, except one free skip per Monday-to-Sunday week when the rule
// allows it. Today is owed, not missed, until it is over, and nothing before `since` counts.
export interface HouseholdStreak { count: number; capturedToday: boolean; skipUsedThisWeek: boolean }

export function captureStreak(days: Set<string>, today: string, since: string, freeSkipsPerWeek: 0 | 1): HouseholdStreak {
  const capturedToday = days.has(today)
  // A missed day spends its week's skip only once a shared day lies beyond it; misses before the
  // streak began are where it began, not skips.
  const used = new Set<string>()
  let pending: string[] = []
  let d = capturedToday ? today : addDays(today, -1)
  let count = 0
  while (d >= since) {
    if (days.has(d)) {
      count++
      pending.forEach((w) => used.add(w))
      pending = []
    } else {
      const w = weekStart(d)
      if (freeSkipsPerWeek === 0 || used.has(w) || pending.includes(w)) break
      pending.push(w)
    }
    d = addDays(d, -1)
  }
  return { count, capturedToday, skipUsedThisWeek: used.has(weekStart(today)) }
}

export function householdStreakOf(rows: SnapRow[], now: Date, rule: HouseholdStreakRule): HouseholdStreak {
  const days = new Set(rows.filter((r) => !r.hidden).map((r) => zoned(new Date(r.createdAt), rule.timeZone).dayKey))
  return captureStreak(days, zoned(now, rule.timeZone).dayKey, rule.since, rule.freeSkipsPerWeek)
}
