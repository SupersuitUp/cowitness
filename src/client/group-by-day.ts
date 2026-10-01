// The day a note was last touched, as the reader's calendar sees it. Grouping happens on the
// client for the same reason the times in a thread do: the server does not know the phone's zone.
export function dayOf(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

// Rows grouped by the reader's calendar day, in the order they were given. `at` says which time
// on a row decides its day: a note's last edit, a snap's posting.
export function groupByDayOf<T>(rows: T[], at: (r: T) => string, now = new Date()): { day: string; rows: T[] }[] {
  const groups: { day: string; rows: T[] }[] = []
  for (const r of rows) {
    const day = dayOf(at(r), now)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(r); else groups.push({ day, rows: [r] })
  }
  return groups
}
