import { otherOf } from './shim.js'
import type { Member } from './shim.js'
import { type Comment, type Photo, type CommentImage } from './types.js'

export class RuleError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 = 403) { super(message) }
}

export const NOTE_MAX = 2000

export const legacyId = (m: Member) => `note-${m}`

export function legacyMessages(p: Threaded): Comment[] {
  const already = new Set((p.comments ?? []).map((c) => c.id))
  return (Object.entries(p.notes ?? {}) as [Member, { text: string; updatedAt: string }][])
    .filter(([by, n]) => n.text.trim() && !already.has(legacyId(by)))
    .map(([by, n]) => ({ id: legacyId(by), by, text: n.text, at: n.updatedAt }))
}

// The conversation under a photo or poem, oldest first. Legacy notes (one per member, from
// the earlier autosaving field) are shown as the first messages, so
// nothing anyone wrote is lost and no consumer has to know there were ever two shapes. A
// legacy note that has since been hearted lives in `comments` under the same id, and is shown
// from there: the legacy field is kept but no longer read for it, so it appears once.
// `notes` is optional because a Us note has no legacy field to carry: it never had the
// autosaving caption a photo had. Everything else about the conversation is identical.
type Threaded = Partial<Pick<Photo, 'notes'>> & Pick<Photo, 'comments'>

export function threadOf(p: Threaded): Comment[] {
  return [...legacyMessages(p), ...(p.comments ?? [])].sort((a, b) => a.at.localeCompare(b.at))
}

// Pictures sent in a message. At most four; each an id in us_comment_images (letters, digits, _ and
// -, so it can never climb a storage path) and a real size. The server replaces the size with the
// one it measured when the picture was filed, so a client can not lie about it.
export const COMMENT_IMAGES_MAX = 4

const IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function validateCommentImages(x: unknown): CommentImage[] | undefined {
  if (x === undefined || x === null) return undefined
  if (!Array.isArray(x)) throw new RuleError('images must be a list', 400)
  if (x.length > COMMENT_IMAGES_MAX) throw new RuleError(`at most ${COMMENT_IMAGES_MAX} pictures in one message`, 400)
  const seen = new Set<string>()
  return x.map((i) => {
    const { id, width, height } = (i ?? {}) as { id?: unknown; width?: unknown; height?: unknown }
    if (typeof id !== 'string' || !IMAGE_ID.test(id)) throw new RuleError('bad picture id', 400)
    if (seen.has(id)) throw new RuleError('the same picture twice', 400)
    seen.add(id)
    const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20000
    if (!ok(width) || !ok(height)) throw new RuleError('bad picture size', 400)
    return { id, width: width as number, height: height as number }
  })
}

// What a message says in a notification or a digest line: its words, or what it holds.
export function messageSummary(c: { text: string; images?: CommentImage[] }): string {
  if (c.text) return c.text
  const n = c.images?.length ?? 0
  return n === 0 ? '' : n === 1 ? 'a photo' : `${n} photos`
}

// The passage a message answers, as it is stored: whitespace folded (a selection across two
// paragraphs arrives with newlines the note never showed as such), and a selection longer than a
// quote should be trimmed rather than refused, because the member meant it and the start of it
// is enough to find it again. Blank means no quote at all.
export const QUOTE_MAX = 500

export function normalizeQuote(q: unknown): string | undefined {
  if (q === undefined || q === null) return undefined
  if (typeof q !== 'string') throw new RuleError('quote must be text', 400)
  const folded = q.replace(/\s+/g, ' ').trim()
  if (!folded) return undefined
  return folded.length > QUOTE_MAX ? `${folded.slice(0, QUOTE_MAX - 1).trimEnd()}…` : folded
}

// Sent, never edited. Blank is refused rather than stored: a message with nothing in it is
// a mis-tap, and it would email the other member about nothing.
export function addComment<T extends Threaded>(
  p: T, actor: Member, text: string, opts: { now?: string; id?: string; quote?: unknown; images?: unknown } = {},
): T {
  const trimmed = text.trim()
  const images = validateCommentImages(opts.images)
  // Words, pictures, or both: a message with neither is a mis-tap.
  if (!trimmed && !images?.length) throw new RuleError('message is empty', 400)
  if (trimmed.length > NOTE_MAX) throw new RuleError('message too long', 400)
  const quote = normalizeQuote(opts.quote)
  const comment: Comment = {
    id: opts.id ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    by: actor, text: trimmed, at: opts.now ?? new Date().toISOString(),
    ...(quote ? { quote } : {}),
    ...(images?.length ? { images } : {}),
  }
  return { ...p, comments: [...(p.comments ?? []), comment] }
}

// A heart on one message, from the member who did not write it. The first time is kept, so a
// double tap is not a second event; turning it off removes the mark. A legacy note is a message
// like any other from the reader's side, so hearting one moves it into `comments` first, under
// the same id and with its own time, and everything downstream sees an ordinary message.
export function heartComment<T extends Threaded>(
  p: T, actor: Member, commentId: string, value: boolean, opts: { now?: string } = {},
): T {
  const legacy = legacyMessages(p).find((c) => c.id === commentId)
  const comments = legacy ? [...(p.comments ?? []), legacy] : p.comments ?? []
  const target = comments.find((c) => c.id === commentId)
  if (!target) throw new RuleError('message not found', 400)
  if (target.by === actor) throw new RuleError('you cannot heart your own message', 400)
  const hearts = { ...(target.hearts ?? {}) }
  if (value) hearts[actor] ??= opts.now ?? new Date().toISOString()
  else delete hearts[actor]
  return { ...p, comments: comments.map((c) => (c.id === commentId ? { ...c, hearts } : c)) }
}

// The newest message from the OTHER member, or undefined when there is none.
export function lastMessageFromOther(p: Threaded, m: Member): string | undefined {
  const o = otherOf(m)
  return threadOf(p).filter((c) => c.by === o).map((c) => c.at).sort().pop()
}

// The one reason given when a recording had no speech in it, on a Notes clip and a Cowitness
// reaction alike. The UI recognises it and says so gently instead of as a failure.
export const NOTHING_HEARD = 'nothing was heard in that recording'

export const CLIP_MAX_SEC = 1200

export const CLIP_MAX_BYTES = 40 * 1024 * 1024

export const CLIP_CONTENT_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac'] as const

export function audioExtension(contentType: string): string {
  return ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' } as Record<string, string>)[contentType] ?? 'bin'
}

export function validateClip(input: { contentType: unknown; size: unknown; durationSec: unknown }): { contentType: string; size: number; durationSec: number } {
  const ct = typeof input.contentType === 'string' ? input.contentType.split(';')[0].trim() : ''
  if (!(CLIP_CONTENT_TYPES as readonly string[]).includes(ct)) throw new RuleError('unsupported audio type', 400)
  const size = typeof input.size === 'number' ? input.size : NaN
  if (!(size > 0 && size <= CLIP_MAX_BYTES)) throw new RuleError('recording is too large', 400)
  const durationSec = typeof input.durationSec === 'number' && input.durationSec > 0 ? input.durationSec : 0
  if (durationSec > CLIP_MAX_SEC + 5) throw new RuleError('recording is longer than twenty minutes', 400)
  return { contentType: ct, size, durationSec }
}

export const VIDEO_MAX_BYTES = 4294967296 // 4 GiB

export const VIDEO_MAX_DURATION_SEC = 21600 // 6 hours

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export function validateVideoDims(input: { durationSec: unknown; width: unknown; height: unknown }): { durationSec: number; width: number; height: number } {
  const { durationSec, width, height } = input
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > VIDEO_MAX_DURATION_SEC) {
    throw new RuleError('durationSec must be more than 0 and at most 21600', 400)
  }
  if (!isPositiveInt(width)) throw new RuleError('width must be a positive whole number', 400)
  if (!isPositiveInt(height)) throw new RuleError('height must be a positive whole number', 400)
  return { durationSec, width, height }
}

// takenAt contract: local wall-clock `YYYY-MM-DDTHH:MM:SS`, the same zone-less
// form photos get from EXIF, so a video sorts among that night's photos. An
// offset is accepted and dropped; a UTC `Z` time is refused, because turning it
// into local time needs a zone the server does not know.
const LOCAL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[+-]\d{2}:?\d{2})?$/

export function localTakenAt(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string' && /Z$/i.test(v)) throw new RuleError('send local time', 400)
  const match = typeof v === 'string' ? LOCAL_TIME_RE.exec(v) : null
  if (!match) throw new RuleError('takenAt must be local time YYYY-MM-DDTHH:MM:SS', 400)
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number)
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi || t.getUTCSeconds() !== s) {
    throw new RuleError('takenAt must be local time YYYY-MM-DDTHH:MM:SS', 400)
  }
  return (v as string).slice(0, 19)
}
