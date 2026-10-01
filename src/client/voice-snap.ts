import { clientConfig } from './config.js'
import type { Snap } from '../types.js'
import { postJson, putWithProgress } from './upload.js'
import { audioOf, forget, isEmpty, keepNoteId, newRecordingId, type VaultStore } from './recording-vault.js'

export interface VoiceSnapMeta { caption: string; language?: string; justUs?: boolean; tags?: string[] }
export interface VoiceSnapOptions {
  /** The server would not take the id this recording was held under, and it is being sent under this
   *  one instead. The caller re-keeps the held recording under it, so a later resend files this snap. */
  onNewId?(snapId: string): void | Promise<void>
}
// A held voice snap's vault key. Reactions use `snap:<id>`; the two never meet.
export const voiceSnapKey = (snapId: string) => `voice-snap:${snapId}`
const snapIdOf = (key: string) => (key.startsWith('voice-snap:') ? key.slice(11) : null)

// The server refused the id itself rather than the recording: it is someone else's, its bytes are
// stamped for someone else, its upload slot is taken, or the signed PUT no longer matches. A fresh
// id is the way through; any other failure keeps the id, so a resend can never file a second snap.
// Every refusal carries the server's status, so a held send can tell a final answer from a passing one.
class Refused extends Error { constructor(message: string, readonly status: number) { super(message) } }
class IdRefused extends Refused {}
const ID_REFUSALS = new Set([403, 409, 412])

async function attempt(blob: Blob, durationSec: number, snapId: string, meta: VoiceSnapMeta, contentType: string): Promise<Snap> {
  const api = clientConfig().apiBase
  const file = () => postJson(`${api}/voice`, {
    snapId, contentType, durationSec, caption: meta.caption,
    ...(meta.language ? { language: meta.language } : {}), ...(meta.justUs ? { justUs: true } : {}), ...(meta.tags?.length ? { tags: meta.tags } : {}),
  })
  const issued = await postJson(`${api}/voice/upload-url`, { snapId, contentType, size: blob.size, durationSec })
  if (issued.status === 409) {
    // The snap may be this phone's own, filed by an earlier send whose answer never came back.
    // Filing the same id again returns it; anything else means the id belongs elsewhere.
    const again = await file()
    if (again.ok) return (await again.json()) as Snap
    if (ID_REFUSALS.has(again.status) || again.status === 404) throw new IdRefused(`id refused (${again.status})`, again.status)
    throw new Refused(`filing refused (${again.status})`, again.status)
  }
  if (ID_REFUSALS.has(issued.status)) throw new IdRefused(`ticket refused (${issued.status})`, issued.status)
  if (!issued.ok) throw new Refused(`ticket refused (${issued.status})`, issued.status)
  const t = (await issued.json()) as { uploaded?: true; url?: string; requiredHeaders?: Record<string, string> }
  // The headers go exactly as issued: the signature covers them, the uploader stamp among them.
  if (!t.uploaded) {
    try {
      await putWithProgress(t.url!, blob, t.requiredHeaders!)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status !== undefined && ID_REFUSALS.has(status)) throw new IdRefused(`upload refused (${status})`, status)
      throw err
    }
  }
  const filed = await file()
  if (ID_REFUSALS.has(filed.status)) throw new IdRefused(`filing refused (${filed.status})`, filed.status)
  if (!filed.ok) throw new Refused(`filing refused (${filed.status})`, filed.status)
  return (await filed.json()) as Snap
}

// A voice note sent the way a spoken reaction is: a ticket, the bytes straight to storage, then the
// filing, under the id of the phone's own held recording, so a retry files the same snap. When the
// server refuses the id itself, it is sent once more under a fresh one, and the caller is told.
export async function sendVoiceSnap(
  blob: Blob, durationSec: number, snapId: string, meta: VoiceSnapMeta, opts: VoiceSnapOptions = {},
): Promise<Snap> {
  const contentType = (blob.type || 'audio/webm').split(';')[0]
  try {
    return await attempt(blob, durationSec, snapId, meta, contentType)
  } catch (err) {
    if (!(err instanceof IdRefused)) throw err
    const fresh = newRecordingId()
    await opts.onNewId?.(fresh)
    return attempt(blob, durationSec, fresh, meta, contentType)
  }
}

// A refusal that sending again cannot change: the server said no to the note itself (a caption too
// long, "just us" from someone who does not share, a recording it will not take). The network, a
// server error, a timeout and a rate limit pass, so those are tried again.
const isFinal = (err: unknown) => {
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** A held voice note the server refused for good, so it was let go. Tell the person once. */
export interface DroppedVoiceSnap { id: string; caption: string; status: number }

// Voice notes this phone kept because the server never confirmed them. Sent quietly on the next
// visit with what was typed for them, and let go once filed. One the server refuses for good is let
// go too, and `onDropped` is told, once, so the app can say so; it is never retried every visit.
// Unfinished ones wait to be offered.
export async function sendHeldVoiceSnaps(
  store: VaultStore, send: typeof sendVoiceSnap = sendVoiceSnap, onDropped?: (d: DroppedVoiceSnap) => void,
): Promise<number> {
  let sent = 0
  for (const rec of await store.all()) {
    const snapId = snapIdOf(rec.noteId)
    if (!snapId || !rec.stopped || isEmpty(rec)) continue
    try {
      await send(audioOf(rec), rec.durationSec, snapId, (rec.meta ?? { caption: '' }) as unknown as VoiceSnapMeta, {
        onNewId: (fresh) => keepNoteId(store, rec.id, voiceSnapKey(fresh)),
      })
      await forget(store, rec.id)
      sent += 1
    } catch (err) {
      if (isFinal(err)) {
        await forget(store, rec.id)
        const caption = typeof rec.meta?.caption === 'string' ? rec.meta.caption : ''
        try { onDropped?.({ id: rec.id, caption, status: (err as { status: number }).status }) } catch { /* the app's notice failing keeps nothing */ }
      }
      // Otherwise still held; the next visit tries again.
    }
  }
  return sent
}
