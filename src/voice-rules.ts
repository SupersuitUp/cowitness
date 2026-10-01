import { RuleError, audioExtension, MESSAGE_MAX, NOTHING_HEARD } from './shared-rules.js'
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
