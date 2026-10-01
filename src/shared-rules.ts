// The message, heart, recording and video-field rules Cowitness needs from the app it was built in,
// unchanged in behaviour except for two generalisations, both identical for a record
// whose authors are members: "the other member" is "anyone but me", and the legacy per-photo note
// (which no snap ever had) is gone. The parity suite compares this file with the original.
import { RuleError } from './errors.js'
import type { Comment, CommentImage } from './types.js'

export { RuleError } from './errors.js'

type Threaded<M extends string = string> = { comments?: Comment<M>[] }

export const MESSAGE_MAX = 2000

// Pictures sent in a message: at most four, each a safe id and a real size.
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

export function parseCommentBody(b: { text?: unknown; images?: unknown }): { kind: 'comment'; text: string; images?: CommentImage[] } {
  if (typeof b.text !== 'string') throw new RuleError('text must be a string', 400)
  const images = validateCommentImages(b.images)
  return images?.length ? { kind: 'comment', text: b.text, images } : { kind: 'comment', text: b.text }
}

export function parseCommentHeart(b: { commentId?: unknown; value?: unknown }): { kind: 'comment-heart'; commentId: string; value: boolean } {
  if (typeof b.commentId !== 'string' || !b.commentId) throw new RuleError('commentId is required', 400)
  if (typeof b.value !== 'boolean') throw new RuleError('value must be a boolean', 400)
  return { kind: 'comment-heart', commentId: b.commentId, value: b.value }
}

export function threadOf<M extends string>(p: Threaded<M>): Comment<M>[] {
  return [...(p.comments ?? [])].sort((a, b) => a.at.localeCompare(b.at))
}

// Sent, never edited. A message with neither words nor pictures is a mis-tap and is refused.
export function addComment<T extends Threaded>(
  p: T, actor: string, text: string, opts: { now?: string; id?: string; images?: unknown } = {},
): T {
  const trimmed = text.trim()
  const images = validateCommentImages(opts.images)
  if (!trimmed && !images?.length) throw new RuleError('message is empty', 400)
  if (trimmed.length > MESSAGE_MAX) throw new RuleError('message too long', 400)
  const comment: Comment = {
    id: opts.id ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    by: actor, text: trimmed, at: opts.now ?? new Date().toISOString(),
    ...(images?.length ? { images } : {}),
  }
  return { ...p, comments: [...(p.comments ?? []), comment] }
}

// A heart on one message, from someone who did not write it. The first time is kept, so a double
// tap is not a second event; turning it off removes the mark.
export function heartComment<T extends Threaded>(
  p: T, actor: string, commentId: string, value: boolean, opts: { now?: string } = {},
): T {
  const comments = p.comments ?? []
  const target = comments.find((c) => c.id === commentId)
  if (!target) throw new RuleError('message not found', 400)
  if (target.by === actor) throw new RuleError('you cannot heart your own message', 400)
  const hearts: Partial<Record<string, string>> = { ...(target.hearts ?? {}) }
  if (value) hearts[actor] ??= opts.now ?? new Date().toISOString()
  else delete hearts[actor]
  return { ...p, comments: comments.map((c) => (c.id === commentId ? { ...c, hearts } : c)) }
}

// The newest message from anyone but `m`, or undefined when there is none.
export function lastMessageFromOther(p: Threaded, m: string): string | undefined {
  return threadOf(p).filter((c) => c.by !== m).map((c) => c.at).sort().pop()
}

// The one reason given when a recording had no speech in it. The screens say so gently.
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

// Local wall-clock YYYY-MM-DDTHH:MM:SS, the zone-less form photos get from EXIF. An offset is
// accepted and dropped; a UTC Z time is refused, because the server does not know the phone's zone.
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
