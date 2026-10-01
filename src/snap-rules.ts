import type { Member } from './types.js'
import type { Circle } from './features.js'
import type { Comment, CowitnessSummary, FiledMedia, Recording, Snap, SnapPatch } from './types.js'
import { RuleError, addComment, heartComment, lastMessageFromOther, validateClip, audioExtension, MESSAGE_MAX, NOTHING_HEARD } from './shared-rules.js'

// Cowitness, as rules. Pure and synchronous so every one of them is tested without Firebase;
// snaps-store.ts only reads, calls one of these, and writes.

export const SNAP_CAPTION_MAX = 500

// Optional. Blank is fine and means no caption; it is never a reason to refuse the snap.
export function validateCaption(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new RuleError('caption must be text', 400)
  const t = v.trim()
  if (t.length > SNAP_CAPTION_MAX) throw new RuleError(`caption must be at most ${SNAP_CAPTION_MAX} characters`, 400)
  return t
}

// The `ctx` a rule is given says who shares and who witnesses. With none, every rule is exactly
// the rule from before options existed.
export const canSeeSnap = (s: Pick<Snap, 'by' | 'hiddenAt' | 'justUs'>, m: Member, ctx?: Circle) =>
  (s.hiddenAt === null || s.by === m) && !(ctx && s.justUs === true && !ctx.sharers.has(m))

// Whether `m` has seen this snap. In the audience kind a witness has their own seen; the person who
// shared it, and anyone who only shares, read the first one as the receipt.
export function seenBy(s: Snap, m: Member, ctx?: Circle): boolean {
  if (ctx?.witnessing === 'audience' && s.by !== m && ctx.witnesses.has(m)) return s.witnessedBy?.[m] !== undefined
  return s.witnessedAt !== null
}

export function assertCanShare(m: Member, ctx?: Circle): void {
  if (ctx?.witnessing === 'audience' && !ctx.sharers.has(m)) throw new RuleError('you cannot share here', 403)
}

export function newSnap(m: Member, media: FiledMedia, caption: string, now: string): Omit<Snap, 'id'> {
  return {
    by: m, caption, kind: media.kind, takenAt: media.takenAt, width: media.width, height: media.height,
    paths: media.paths, ...(media.video ? { video: media.video } : {}),
    witnessedAt: null, hiddenAt: null, createdAt: now,
  }
}

export function applySnapPatch(
  s: Snap, actor: Member, patch: SnapPatch,
  opts: { now?: string; id?: string; ctx?: Circle; tags?: ReadonlySet<string>; maxTags?: number; justUs?: boolean } = {},
): Snap {
  const now = opts.now ?? new Date().toISOString()
  // A hidden snap belongs to the member who hid it until they bring it back.
  if (!canSeeSnap(s, actor, opts.ctx)) throw new RuleError('this snap is hidden', 403)
  switch (patch.kind) {
    case 'comment':
      return addComment(s, actor, patch.text, { now, id: opts.id, images: patch.images })
    case 'comment-heart':
      return heartComment(s, actor, patch.commentId, patch.value, { now })
    case 'hide':
      if (s.by !== actor) throw new RuleError('only the member who shared it can hide it', 403)
      return s.hiddenAt ? s : { ...s, hiddenAt: now }
    case 'unhide':
      if (s.by !== actor) throw new RuleError('only the member who shared it can bring it back', 403)
      return { ...s, hiddenAt: null }
    // Nothing can be skipped, but silence is allowed: Next always marks it witnessed, and a typed
    // reaction rides in the same write so the receipt and the words can never disagree.
    case 'witness': {
      if (s.by === actor) throw new RuleError('you cannot witness your own snap', 400)
      let seen: Snap
      if (opts.ctx?.witnessing === 'audience') {
        if (!opts.ctx.witnesses.has(actor)) throw new RuleError('only someone who witnesses can witness', 403)
        seen = s.witnessedBy?.[actor]
          ? s
          : { ...s, witnessedBy: { ...(s.witnessedBy ?? {}), [actor]: now }, witnessedAt: s.witnessedAt ?? now }
      } else {
        seen = s.witnessedAt ? s : { ...s, witnessedAt: now }
      }
      const text = patch.text?.trim()
      return text ? addComment(seen, actor, text, { now, id: opts.id }) : seen
    }
    // A kind this rule does not apply (an option's patch, or one from a newer client) is refused,
    // never answered with nothing.
    default:
      throw new RuleError('unknown patch kind', 400)
  }
}

const newestFirst = (a: Snap, b: Snap) => b.createdAt.localeCompare(a.createdAt)
const oldestFirst = (a: Snap, b: Snap) => a.createdAt.localeCompare(b.createdAt)

// Everything, forever, both members in one stream, newest first.
export function archiveOf<T extends Snap>(snaps: T[], m: Member, ctx?: Circle): T[] {
  return snaps.filter((s) => canSeeSnap(s, m, ctx)).sort(newestFirst)
}

// The Cowitness home keeps only what is still open: nothing witnessed yet, from either side.
// Everything witnessed moves to its own shelf, so the home stays small however long this runs.
export function openOf<T extends Snap>(snaps: T[], m: Member, ctx?: Circle): T[] {
  return archiveOf(snaps, m, ctx).filter((s) => !seenBy(s, m, ctx))
}

export function witnessedOf<T extends Snap>(snaps: T[], m: Member, ctx?: Circle): T[] {
  return archiveOf(snaps, m, ctx).filter((s) => seenBy(s, m, ctx))
}

// The one image a grid tile shows: the thumbnail, or a video's poster. A tile never needs the
// display size or the video itself, so nothing else is signed for it.
export function thumbPathOf(s: Snap): string | null {
  if (s.kind === 'video') return s.video?.posterPath || null
  return s.paths.thumb || null
}

export function snapHasNew(s: Snap, m: Member, lastSeenAt: string, ctx?: Circle): boolean {
  if (!canSeeSnap(s, m, ctx)) return false
  const otherAt = lastMessageFromOther(s, m)
  return (s.by !== m && s.createdAt > lastSeenAt) || (otherAt !== undefined && otherAt > lastSeenAt)
}

// The newest visible snap with an image to show. A video with no poster has none.
export function coverOf(snaps: Snap[], m: Member, ctx?: Circle): Snap | null {
  return archiveOf(snaps, m, ctx).find((s) => !!s.paths.thumb) ?? null
}

// What is waiting for `m`, oldest first, because a session walks through the day in the order it
// happened. In the audience kind only a witness has a queue, and it is what they have not seen.
export function queueOf<T extends Snap>(snaps: T[], m: Member, ctx?: Circle): T[] {
  if (ctx?.witnessing === 'audience') {
    if (!ctx.witnesses.has(m)) return []
    return snaps.filter((s) => s.by !== m && s.hiddenAt === null && canSeeSnap(s, m, ctx) && s.witnessedBy?.[m] === undefined).sort(oldestFirst)
  }
  return snaps.filter((s) => s.by !== m && s.hiddenAt === null && s.witnessedAt === null && (!ctx || canSeeSnap(s, m, ctx))).sort(oldestFirst)
}

export function cowitnessTile(snaps: Snap[], m: Member, lastSeenAt: string, coverUrl: string | null, ctx?: Circle): CowitnessSummary {
  const visible = archiveOf(snaps, m, ctx)
  return {
    count: visible.length, coverUrl, hasNew: visible.some((s) => snapHasNew(s, m, lastSeenAt, ctx)),
    waiting: queueOf(snaps, m, ctx).length,
  }
}

// A reaction to a snap is not a journal entry.
export const REACTION_MAX_SEC = 180

// `prefix` is the app's storage prefix, so a reaction lands beside the app's own files.
export function reactionAudioPath(prefix: string, snapId: string, commentId: string, contentType: string): string {
  return `${prefix}snaps-audio/${snapId}/${commentId}.${audioExtension(contentType)}`
}

// The client mints this id (from its own vault record, stable across a retry) rather than the
// server, so a resend after a lost response reuses the same id and the server's own idempotency
// in addVoiceReaction is what stops it becoming a second comment. Shape-checked before it ever
// touches a storage path or a signed URL.
const COMMENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function validateCommentId(v: unknown): string {
  if (typeof v !== 'string' || !COMMENT_ID_RE.test(v)) throw new RuleError('commentId must be 8 to 64 letters, numbers, - or _', 400)
  return v
}

export type ReactionTicket = { commentId: string; uploaded: true } | { commentId: string; url: string; requiredHeaders: Record<string, string> }

// The bytes might already be sitting at this id's object path: a resend of a held recording
// whose PUT actually landed last time, just before the response that would have told the phone
// so was lost. A second signed URL for the same id would 412 on GCS's create-once guard the
// moment the phone tried it (create-once is still enforced on the PUT itself, unchanged); the
// caller does not need a second PUT at all when the bytes are already there, so this hands back
// nothing to PUT to and lets the client skip straight to filing it.
export function reactionTicket(commentId: string, alreadyUploaded: boolean, url: string, requiredHeaders: Record<string, string>): ReactionTicket {
  return alreadyUploaded ? { commentId, uploaded: true } : { commentId, url, requiredHeaders }
}

// Same types and byte ceiling as a Notes clip, with the shorter cap. A recorder stopped at the
// cap reports a second or two over it, so the refusal leaves five seconds of grace.
export function validateReactionClip(input: { contentType: unknown; size: unknown; durationSec: unknown }): { contentType: string; size: number; durationSec: number } {
  const clip = validateClip(input)
  if (clip.durationSec > REACTION_MAX_SEC + 5) throw new RuleError('a reaction is at most three minutes', 400)
  return clip
}

// A spoken reaction is a message whose words arrive later. Filed once per id: a retried attach
// after a dropped connection must never put the same voice under the snap twice.
export function addVoiceReaction(s: Snap, actor: Member, commentId: string, rec: Recording, opts: { now?: string } = {}): Snap {
  if (!canSeeSnap(s, actor)) throw new RuleError('this snap is hidden', 403)
  if ((s.comments ?? []).some((c) => c.id === commentId)) return s
  const comment = { id: commentId, by: actor, text: '', at: opts.now ?? new Date().toISOString(), recording: rec }
  return { ...s, comments: [...(s.comments ?? []), comment] }
}

type Spoken = Comment & { recording: Recording }

function onRecording(s: Snap, commentId: string, change: (c: Spoken) => Comment): Snap {
  const target = (s.comments ?? []).find((c) => c.id === commentId)
  if (!target?.recording) throw new RuleError('reaction not found', 404)
  return { ...s, comments: (s.comments ?? []).map((c) => (c.id === commentId ? change(c as Spoken) : c)) }
}

// The recording without any transcript state: the keys are dropped, never set to undefined,
// because Firestore refuses an undefined value.
function settled(r: Recording): Recording {
  const { status: _status, reason: _reason, startedAt: _startedAt, ...rest } = r
  return rest
}

// Stamps startedAt every time a recording moves to 'transcribing', auto or Try again alike, so
// canRetranscribe can measure how long THIS attempt has actually been running rather than how
// old the reaction is.
export function markTranscribing(s: Snap, commentId: string, language?: string, opts: { now?: string } = {}): Snap {
  const startedAt = opts.now ?? new Date().toISOString()
  return onRecording(s, commentId, (c) => ({
    ...c, recording: { ...settled(c.recording), ...(language ? { language } : {}), status: 'transcribing', startedAt },
  }))
}

export function setReactionTranscript(s: Snap, commentId: string, text: string): Snap {
  const words = text.trim().slice(0, MESSAGE_MAX)
  if (!words) return failReactionTranscript(s, commentId, NOTHING_HEARD)
  return onRecording(s, commentId, (c) => ({ ...c, text: words, recording: settled(c.recording) }))
}

export function failReactionTranscript(s: Snap, commentId: string, reason: string): Snap {
  return onRecording(s, commentId, (c) => ({ ...c, recording: { ...settled(c.recording), status: 'failed', reason } }))
}

// The auto transcription an attach schedules for itself is only ever allowed to run against a
// recording still exactly as attachReaction left it. An idempotent re-attach of the same
// commentId (a phone resending a clip whose first response never arrived) must never schedule a
// second job that clobbers a transcript already written, or races the first job's write with a
// second one: this is the gate that makes a stray extra schedule harmless if one ever occurs.
export function canAutoTranscribe(rec: Recording): boolean {
  return rec.status === 'transcribing'
}

// Longer than any function invocation can run: a 'transcribing' recording still in that state
// past this age was killed mid-run rather than genuinely in flight, and Try again may recover it.
const RETRANSCRIBE_STALE_MS = 5 * 60 * 1000

// Try again is allowed from a failure, from a finished transcript (a re-listen, e.g. a different
// language), or from a transcribing job old enough that nothing could still be running it. It is
// refused, with a conflict, while a genuinely live transcription is still within that window.
//
// Staleness is measured from the recording's OWN startedAt, not the comment's `at`: a reaction
// filed hours ago whose transcription only just began is still a live job and must stay
// protected, however old the comment is. `commentAt` is only a fallback for a recording filed
// before this field existed.
export function canRetranscribe(rec: Recording, commentAt: string, now: string): boolean {
  if (rec.status !== 'transcribing') return true
  const startedAt = rec.startedAt ?? commentAt
  return new Date(now).getTime() - new Date(startedAt).getTime() > RETRANSCRIBE_STALE_MS
}
