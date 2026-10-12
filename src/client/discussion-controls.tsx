'use client'

import type { CSSProperties, TextareaHTMLAttributes } from 'react'
import { DISCUSSION_EMOJIS } from '../discussion.js'
import { INK, ON_INK, SERIF, HAIRLINE, ACCENT } from './theme.js'

// Controlled components: the host retains permissions, transport, attachments and notifications.
export function DiscussionInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props}
    className={props.className ?? 'w-full resize-none rounded-2xl bg-white/70 px-4 py-3 text-[17px] leading-relaxed'}
    style={{ color: INK, fontFamily: SERIF, border: `1px solid ${HAIRLINE}`, ...props.style, fontSize: '17px', minHeight: '44px' }} />
}

export function DiscussionSend({ busy, canSend, onSend, style }: {
  busy: boolean; canSend: boolean; onSend(): void; style?: CSSProperties
}) {
  return <button type="button" disabled={busy || !canSend} onClick={onSend}
    className="rounded-full px-5 text-sm font-medium disabled:opacity-40"
    style={{ backgroundColor: INK, color: ON_INK, ...style, minHeight: 44 }}>{busy ? 'Sending' : 'Send'}</button>
}

export function EmojiReactions({ me, names, marks, busy, existingOnly, onToggle, style, accent = ACCENT, hairline = HAIRLINE }: {
  me: string; names: Record<string, string>; marks: { by: string; emoji: string }[];
  busy?: boolean; existingOnly?: boolean; onToggle(emoji: string, value: boolean): void; style?: CSSProperties
  accent?: string; hairline?: string
}) {
  return <div className="flex flex-wrap gap-1" role="group" aria-label={existingOnly ? 'Reactions' : 'Choose a reaction'}>
    {DISCUSSION_EMOJIS.map((emoji) => {
      const people = [...new Set(marks.filter((r) => r.emoji === emoji).map((r) => r.by))]
      if (existingOnly && !people.length) return null
      const mine = people.includes(me)
      return <button key={emoji} type="button" disabled={busy} aria-pressed={mine}
        aria-label={existingOnly ? `${emoji} · ${people.map((m) => names[m] ?? m).join(', ')}` : `${mine ? 'Remove' : 'Add'} ${emoji}`}
        title={people.map((m) => names[m] ?? m).join(', ')} onClick={() => onToggle(emoji, !mine)}
        className="rounded-full border px-3 text-xl disabled:opacity-40"
        style={{ borderColor: mine ? accent : hairline, ...style, minHeight: 44, minWidth: 44 }}>
        {emoji}{people.length > 0 && <span className="ml-1 text-sm">{people.length}</span>}
      </button>
    })}
  </div>
}

// Raw strings preserve hosts' existing keys and formats. Storage is optional; a stale successful
// send may only clear the exact draft it sent, never newer words written while it was in flight.
export function readDiscussionDraft(key: string): string | null {
  try { return window.sessionStorage.getItem(key) } catch { return null }
}
export function writeDiscussionDraft(key: string, text: string): void {
  try { window.sessionStorage.setItem(key, text) } catch { /* optional storage */ }
}
export function clearDiscussionDraft(key: string, ifText?: string): void {
  try {
    if (ifText === undefined || window.sessionStorage.getItem(key) === ifText) window.sessionStorage.removeItem(key)
  } catch { /* optional storage */ }
}
