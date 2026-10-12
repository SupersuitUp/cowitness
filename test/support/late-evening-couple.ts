// The couple whose screenshot started this: fifteen days running, both of them sharing every one
// of them, counted wrong because one phone was an hour east of the other.
//
// Ana shares around midday, which is the same calendar day in either zone. Ben shares at 11:30pm
// in America/Chicago, which is already 00:30 the NEXT day in America/New_York, on every day but
// one (2026-10-10), where he shares at midday like her.
//
// Read in America/Chicago, the zone the couple keeps, that is fifteen days each and fifteen
// together. Read on a phone set to America/New_York it is 15 / 1 / 0: every one of Ben's late
// snaps lands on the following day there, which doubles up on the day he already had and leaves
// the day he actually shared empty, so his run breaks at the one midday snap and the together run
// has no yesterday to stand on.
//
// `NOW` is deliberately an instant where the two zones disagree about what day it is (11:45pm on
// the 11th in Chicago, 00:45am on the 12th in New York). A zone test whose zones agree at its own
// instant passes whether or not the zone is read at all, so the disagreement is asserted as a
// premise before any count is.
export const COUPLE_ZONE = 'America/Chicago'
export const EASTERN = 'America/New_York'

export const NOW = new Date('2026-10-12T04:45:00Z')
export const CHICAGO_TODAY = '2026-10-11'
export const EASTERN_TODAY = '2026-10-12'

/** The fifteen Chicago days the two of them shared, oldest first: 2026-09-27 to 2026-10-11. */
export const DAYS = Array.from({ length: 15 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 27) + i * 86_400_000).toISOString().slice(0, 10))

/** The one day Ben shared at midday instead of late in the evening. */
export const BEN_MIDDAY_DAY = '2026-10-10'

const nextDay = (key: string) => new Date(new Date(`${key}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)

/** When each snap was taken, ISO, in the order the two of them shared. */
export function lateEveningTimes(): { by: 'ana' | 'ben'; createdAt: string }[] {
  return DAYS.flatMap((day) => [
    // 17:00Z is midday in Chicago and early afternoon in New York: one calendar day either way.
    { by: 'ana' as const, createdAt: `${day}T17:00:00Z` },
    day === BEN_MIDDAY_DAY
      ? { by: 'ben' as const, createdAt: `${day}T17:00:00Z` }
      // 04:30Z the next morning is 11:30pm that evening in Chicago and 00:30am the next day in New York.
      : { by: 'ben' as const, createdAt: `${nextDay(day)}T04:30:00Z` },
  ])
}
