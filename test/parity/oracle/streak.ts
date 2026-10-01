import type { Member } from './shim.js'
import type { SnapRow } from './cowitness-format.js'
import { PAIR } from './shim.js'

export interface Streak { count: number; postedToday: boolean }

export type Streaks = Record<Member, Streak> & { together: Streak }

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

// A hidden snap is left out, so the number is the same on both phones: the other member cannot
// see it, and a streak built on something they cannot see would read as a different number.
export function streaksOf(rows: SnapRow[], now = new Date()): Streaks {
  const shared = rows.filter((r) => !r.hidden)
  const [a, b] = PAIR.map((m) => daysOf(shared.filter((r) => r.by === m).map((r) => r.createdAt)))
  const both = new Set([...a].filter((d) => b.has(d)))
  return { [PAIR[0]]: countFrom(a, now), [PAIR[1]]: countFrom(b, now), together: countFrom(both, now) } as Streaks
}
