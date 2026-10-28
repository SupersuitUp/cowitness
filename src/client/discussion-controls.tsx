'use client'

import { useState, type CSSProperties, type TextareaHTMLAttributes } from 'react'
import { DISCUSSION_EMOJIS, isSingleEmoji } from '../discussion.js'
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

/** The last grapheme typed into the free pick, so a keyboard that inserts beside earlier text still works. */
function lastGrapheme(text: string): string {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Seg) return text.trim()
  const parts = [...new Seg(undefined, { granularity: 'grapheme' }).segment(text.trim())]
  return parts.length ? parts[parts.length - 1].segment : ''
}

// The six quick picks come first, then any other emoji someone has already used here, in the
// order it first appeared, so a free pick is visible and tappable by everyone. `anyEmoji` adds a
// free pick: a + that opens the phone's own emoji keyboard and accepts one emoji (us-template#7).
// It is opt-in because a host whose server still checks the six would refuse the pick; turn it on
// once the host validates with isSingleEmoji.
export function EmojiReactions({ me, names, marks, busy, existingOnly, anyEmoji, onToggle, style, accent = ACCENT, hairline = HAIRLINE }: {
  me: string; names: Record<string, string>; marks: { by: string; emoji: string }[];
  busy?: boolean; existingOnly?: boolean; anyEmoji?: boolean; onToggle(emoji: string, value: boolean): void; style?: CSSProperties
  accent?: string; hairline?: string
}) {
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState('')
  const quick = DISCUSSION_EMOJIS as readonly string[]
  const extras = [...new Set(marks.map((r) => r.emoji))].filter((e) => !quick.includes(e) && isSingleEmoji(e))
  const pick = (text: string) => {
    setDraft(text)
    const emoji = lastGrapheme(text)
    if (!isSingleEmoji(emoji)) return
    setDraft(''); setPicking(false)
    if (!marks.some((r) => r.by === me && r.emoji === emoji)) onToggle(emoji, true)
  }
  return <div className="flex flex-wrap gap-1" role="group" aria-label={existingOnly ? 'Reactions' : 'Choose a reaction'}>
    {[...quick, ...extras].map((emoji) => {
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
    {anyEmoji && !existingOnly && (picking
      ? <input autoFocus type="text" value={draft} disabled={busy} aria-label="Pick any emoji" placeholder="Any emoji"
          enterKeyHint="done" autoComplete="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => pick(e.target.value)}
          onBlur={() => { setPicking(false); setDraft('') }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setPicking(false); setDraft('') } }}
          className="rounded-full border px-3 text-xl"
          style={{ borderColor: accent, ...style, minHeight: 44, width: 120, fontSize: 20 }} />
      : <button type="button" disabled={busy} aria-label="Add any emoji" title="Any emoji" onClick={() => setPicking(true)}
          className="rounded-full border px-3 text-xl disabled:opacity-40"
          style={{ borderColor: hairline, ...style, minHeight: 44, minWidth: 44 }}>+</button>)}
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
