import { RuleError } from './errors.js'
import { daysBetween, inWindow, zoned } from './zoned.js'
import type { PromptPerson, PromptSettings } from './types.js'

// A few reminders a day, each to ONE person so two people are never nagged at once. The slots are
// every time anyone picked; each slot goes to one person who picked it and is not snoozed, taking
// turns by slot and by day.
export function promptsDue<M extends string>(now: Date, timeZone: string, people: PromptPerson<M>[], sent: Set<string>): { slotKey: string; key: M }[] {
  const { dayKey, hhmm } = zoned(now, timeZone)
  const awake = people.filter((p) => !(p.snoozedUntil && p.snoozedUntil >= dayKey)).sort((a, b) => a.key.localeCompare(b.key))
  const slots = [...new Set(people.flatMap((p) => p.times))].sort()
  const dayIndex = daysBetween('2000-01-01', dayKey)
  const out: { slotKey: string; key: M }[] = []
  slots.forEach((slot, i) => {
    const slotKey = `${dayKey}@${slot}`
    if (!inWindow(slot, hhmm) || sent.has(slotKey)) return
    const eligible = awake.filter((p) => p.times.includes(slot))
    if (eligible.length === 0) return
    out.push({ slotKey, key: eligible[(dayIndex + i) % eligible.length].key })
  })
  return out
}

export const PROMPT_TIMES_MAX = 6
export const PROMPT_TIME_LATEST = '23:00'
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// A person's own reminder times, and "not today". `today` is the day in the reminders' time zone.
// A slot stays due for an hour and the window does not wrap midnight, so a time after 23:00 could
// run out of window before the day ends: those are refused.
export function parsePromptPatch(body: unknown, current: PromptSettings, today: string): PromptSettings {
  const b = (body ?? {}) as { times?: unknown; snoozeToday?: unknown }
  let times = current.times
  if (b.times !== undefined) {
    if (!Array.isArray(b.times) || !b.times.every((t) => typeof t === 'string' && HHMM.test(t))) throw new RuleError('times must be HH:MM values', 400)
    if (b.times.length > PROMPT_TIMES_MAX) throw new RuleError('at most six reminder times', 400)
    if ((b.times as string[]).some((t) => t > PROMPT_TIME_LATEST)) throw new RuleError('reminder times must be 23:00 or earlier', 400)
    times = [...new Set(b.times as string[])].sort()
  }
  const snoozedUntil = b.snoozeToday === true ? today : b.snoozeToday === false ? null : current.snoozedUntil
  return { times, snoozedUntil }
}
