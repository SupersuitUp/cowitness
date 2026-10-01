// Streaks: how many days in a row someone has shared a snap. Pure, and computed on the phone,
// because a "day" is the viewer's local calendar day and the server does not know the phone's
// zone. The member keys are passed in rather
// than read from the app's own list of people, and "together" is the days every one shared.
import type { SnapRow } from './format.js'

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
