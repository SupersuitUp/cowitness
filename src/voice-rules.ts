import { RuleError, audioExtension, CLIP_CONTENT_TYPES, MESSAGE_MAX, NOTHING_HEARD } from './shared-rules.js'
import { canRetranscribe } from './snap-rules.js'
import type { Member, Snap, VoiceInfo } from './types.js'

// A voice snap, as rules: a recording shared to be witnessed, with no picture. Its words arrive
// later, exactly as a spoken reaction's do.

// The phone mints a voice snap's id from its own held recording, so a resend after a lost answer
// files the same snap rather than a second one. Shape-checked before it touches a storage path.
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export function validateClientId(v: unknown, name: string): string {
  if (typeof v !== 'string' || !CLIENT_ID_RE.test(v)) throw new RuleError(`${name} must be 8 to 64 letters, numbers, - or _`, 400)
  return v
}

// `prefix` is the app's storage prefix, so a voice note lands beside the app's own files.
export const voiceSnapPath = (prefix: string, snapId: string, contentType: string) =>
  `${prefix}snaps-voice/${snapId}.${audioExtension(contentType)}`

// Every path one id could have, one per audio type. An id is one recording: once any of these
// exists, the id's type is fixed and no other is ever signed or filed for it.
export const voiceSnapPaths = (prefix: string, snapId: string): string[] =>
  [...new Set(CLIP_CONTENT_TYPES.map((ct) => voiceSnapPath(prefix, snapId, ct)))]

// The custom metadata key a voice upload is stamped with: who the signed PUT was issued to.
export const VOICE_UPLOADER_KEY = 'cowitness-by'

export function newVoiceSnap(m: Member, voice: VoiceInfo, caption: string, now: string, extra: { justUs?: true; tags?: string[] } = {}): Omit<Snap, 'id'> {
  return {
    by: m, caption, kind: 'voice', takenAt: now, width: 0, height: 0, paths: { original: '', display: '', thumb: '' },
    voice, witnessedAt: null, hiddenAt: null, createdAt: now,
    ...(extra.justUs ? { justUs: true as const } : {}), ...(extra.tags?.length ? { tags: extra.tags } : {}),
  }
}

// The keys are dropped, never set to undefined, because Firestore refuses an undefined value.
function settled(v: VoiceInfo): VoiceInfo {
  const { status: _status, reason: _reason, startedAt: _startedAt, ...rest } = v
  return rest
}
function onVoice(s: Snap, change: (v: VoiceInfo) => VoiceInfo): Snap {
  if (s.kind !== 'voice' || !s.voice) throw new RuleError('voice note not found', 404)
  return { ...s, voice: change(s.voice) }
}

export const markVoiceTranscribing = (s: Snap, language: string | undefined, opts: { now?: string } = {}) =>
  onVoice(s, (v) => ({ ...settled(v), ...(language ? { language } : {}), status: 'transcribing', startedAt: opts.now ?? new Date().toISOString() }))

export function setVoiceTranscript(s: Snap, text: string): Snap {
  const words = text.trim().slice(0, MESSAGE_MAX)
  if (!words) return failVoiceTranscript(s, NOTHING_HEARD)
  return onVoice(s, (v) => ({ ...settled(v), text: words }))
}

export const failVoiceTranscript = (s: Snap, reason: string) =>
  onVoice(s, (v) => ({ ...settled(v), status: 'failed', reason }))

// Who may hear a voice snap's words again. Its author may at any time but during a live run (another
// language, another try). Anyone else who can see it may only rescue a run that failed or stalled
// past the window; settled words are the author's, and a stranger looping the transcriber is a cost.
export function assertMayRetranscribeVoice(s: Snap, m: Member, now: string): void {
  if (s.kind !== 'voice' || !s.voice) throw new RuleError('voice note not found', 404)
  const v = s.voice
  if (!canRetranscribe(v, s.createdAt, now)) throw new RuleError('this voice note is still being transcribed', 409)
  if (s.by !== m && v.status !== 'failed' && v.status !== 'transcribing') throw new RuleError('only the person who shared it can transcribe it again', 403)
}

// The same rule as a yes or no, for a screen deciding whether to offer it at all.
export function mayRetranscribeVoice(s: Snap, m: Member, now: string): boolean {
  try { assertMayRetranscribeVoice(s, m, now); return true } catch { return false }
}

// Whether a finished run may still write: only while the snap is in the very run it started. A run
// overtaken by a newer one (a Try again after it stalled) is dropped, so it can neither overwrite the
// newer words nor clear the newer run's status.
export const isVoiceRun = (s: Snap, startedAt: string | undefined) =>
  s.voice?.status === 'transcribing' && startedAt !== undefined && s.voice.startedAt === startedAt
