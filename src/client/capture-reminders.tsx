'use client'

import { useState, type ReactNode } from 'react'
import type { PromptSettings } from '../types.js'
import { clientConfig } from './config.js'
import { HAIRLINE, INK, MUTED, SERIF } from './theme.js'

// A person's own reminder times, and "Not today". The app's own notification switch goes inside,
// because reminders reach nobody until notifications are on.
export function CaptureReminders({ initial, children }: { initial: PromptSettings & { today: string }; children?: ReactNode }) {
  const [s, setS] = useState<PromptSettings>({ times: initial.times, snoozedUntil: initial.snoozedUntil })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial.times.join(', '))
  const [failed, setFailed] = useState(false)
  const snoozed = s.snoozedUntil !== null && s.snoozedUntil >= initial.today
  // Whether the save landed, so a refused edit keeps what was typed rather than throwing it away.
  const save = async (body: unknown): Promise<boolean> => {
    setFailed(false)
    const res = await fetch(`${clientConfig().apiBase}/prompts`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (res?.ok) { setS((await res.json()) as PromptSettings); return true }
    setFailed(true)
    return false
  }
  return (
    <section aria-label="Reminders" className="mx-4 rounded-2xl p-4" style={{ border: `1px solid ${HAIRLINE}` }}>
      <p className="text-sm" style={{ color: MUTED }}>Reminders</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {s.times.map((t) => <li key={t} className="rounded-full px-3 py-1 text-sm" style={{ color: INK, border: `1px solid ${HAIRLINE}`, fontFamily: SERIF }}>{t}</li>)}
      </ul>
      {editing ? (
        <div className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="reminder-times">Times</label>
          <input id="reminder-times" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-11 flex-1 rounded-2xl px-3 text-sm" style={{ border: `1px solid ${HAIRLINE}` }} />
          <button type="button" className="h-11 px-3 text-sm" style={{ color: INK }} onClick={async () => { if (await save({ times: draft.split(',').map((x) => x.trim()).filter(Boolean) })) setEditing(false) }}>Save</button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" className="h-11 px-3 text-sm" style={{ color: INK }} onClick={() => setEditing(true)}>Edit times</button>
          {snoozed
            ? <><span className="flex h-11 items-center text-sm" style={{ color: MUTED }}>Snoozed for today</span><button type="button" className="h-11 px-3 text-sm underline underline-offset-2" style={{ color: INK }} onClick={() => save({ snoozeToday: false })}>Undo</button></>
            : <button type="button" className="h-11 px-3 text-sm" style={{ color: INK }} onClick={() => save({ snoozeToday: true })}>Not today</button>}
        </div>
      )}
      {failed && <p role="alert" className="mt-2 text-sm" style={{ color: MUTED }}>That did not save. Try again.</p>}
      {children}
    </section>
  )
}
