'use client'

import { useEffect, useState } from 'react'
import type { Member, MemberNames } from '../types.js'
import type { SnapRow } from '../format.js'
import { householdStreakOf, streaksOf, type Streak } from '../streak.js'
import { clientFeatures } from './config.js'
import { ACCENT_TINT, HAIRLINE, INK, MUTED, SERIF } from './theme.js'
import { otherIn } from './people.js'

const streakWord = (n: number) => `${n}-day streak`

function Pill({ label, s }: { label: string; s: Streak }) {
  return (
    <li className="flex-1 rounded-2xl px-3 py-2 text-center" style={{ backgroundColor: s.count > 0 ? ACCENT_TINT : HAIRLINE }}>
      <span className="block text-2xl" style={{ color: INK, fontFamily: SERIF, fontWeight: 500, opacity: s.count > 0 && !s.postedToday ? 0.55 : 1 }}>
        <span aria-hidden>{s.count > 0 ? '🔥' : ''}</span>{s.count}
      </span>
      <span className="block text-[11px] font-medium tracking-wide uppercase" style={{ color: MUTED }}>{label}</span>
    </li>
  )
}

// Days in a row each of you shared a snap, and days in a row you both did. A streak whose owner
// has not shared yet today is faded: still alive, ends at midnight. Rendered only after mount,
// because a day is the phone's local day and the server render would count in its own zone.
// The household streak is one count for everyone who shares, in the app's own time zone. A person
// who does not share (`shares` false) is shown no streak at all: a count over what they can see would
// be wrong, and one over everything would tell them private days exist.
export function StreakStrip({ rows, me, names, shares = true }: { rows: SnapRow[]; me: Member; names: MemberNames; shares?: boolean }) {
  const rule = clientFeatures().streak
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])
  if (!now || !shares) return null
  if (rule.kind === 'household') {
    const h = householdStreakOf(rows, now, rule)
    return (
      <section aria-label="Streak" className="px-4">
        <ul className="flex gap-2"><Pill label="Days in a row" s={{ count: h.count, postedToday: h.capturedToday }} /></ul>
        <p className="mt-2 text-center text-[14px]" style={{ color: MUTED, fontFamily: SERIF }}>
          {h.capturedToday ? 'Something was shared today.' : h.count > 0 ? `Share something today to keep the ${h.count}-day streak.` : 'Share something today to start a streak.'}
          {h.skipUsedThisWeek ? ' One free skip used this week.' : ''}
        </p>
      </section>
    )
  }
  const s = streaksOf(rows, now, Object.keys(names))
  const other: Member = otherIn(names, me)
  const mine = s[me]
  return (
    <section aria-label="Streaks" className="px-4">
      <ul className="flex gap-2">
        <Pill label="You" s={mine} />
        <Pill label={names[other]} s={s[other]} />
        <Pill label="Together" s={s.together} />
      </ul>
      <p className="mt-2 text-center text-[14px]" style={{ color: MUTED, fontFamily: SERIF }}>
        {mine.postedToday
          ? `You shared today. ${s[other].postedToday ? `${names[other]} did too.` : `Waiting on ${names[other]}.`}`
          : mine.count > 0
            ? `Share a snap today to keep your ${streakWord(mine.count)}.`
            : 'Share a snap today to start a streak.'}
      </p>
    </section>
  )
}
