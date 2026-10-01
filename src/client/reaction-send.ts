import { clientConfig } from './config.js'
import type { Comment } from '../types.js'
import { postJson } from './upload.js'
import { putWithProgress } from './upload.js'
import { audioOf, forget, isEmpty, type VaultStore } from './recording-vault.js'

// A spoken reaction, sent the way a Notes recording is: a ticket, the bytes straight to storage,
// then the filing. Any failure throws, and the caller keeps the recording in the phone's vault.
export const reactionKey = (snapId: string) => `snap:${snapId}`
export const snapIdOfKey = (key: string) => (key.startsWith('snap:') ? key.slice(5) : null)

// commentId is minted by the CALLER, not here: for a fresh reaction it is the id of the vault
// record the caller just wrote, and for a resend of a held recording it is that same record's
// id again (see sendHeld below). That is what makes a retry idempotent: the id never changes
// between attempts, so the server's own addVoiceReaction collapses a second attach into a no-op
// instead of filing a duplicate comment.
export async function sendReaction(snapId: string, blob: Blob, durationSec: number, commentId: string): Promise<Comment[]> {
  const contentType = blob.type || 'audio/webm'
  const issued = await postJson(`${clientConfig().apiBase}/${snapId}/reactions/upload-url`, { contentType, size: blob.size, durationSec, commentId })
  if (!issued.ok) throw new Error(`ticket refused (${issued.status})`)
  const t = (await issued.json()) as { uploaded?: true; url?: string; requiredHeaders?: Record<string, string> }
  // Already there from an earlier attempt whose response never made it back (a resend, not a
  // fresh send): nothing to PUT, and PUTting it again would only 412 against create-once.
  if (!t.uploaded) await putWithProgress(t.url!, blob, t.requiredHeaders!)
  const filed = await postJson(`${clientConfig().apiBase}/${snapId}/reactions`, { commentId, contentType, durationSec })
  if (!filed.ok) throw new Error(`filing refused (${filed.status})`)
  const snap = (await filed.json()) as { comments?: Comment[] }
  return snap.comments ?? []
}

// Reactions this phone kept because the server never confirmed them: a dropped connection, a
// closed tab mid-send. Sent quietly on the next visit and let go only once the server has them.
// Only finished recordings: one cut off mid-sentence by leaving the session was never a
// reaction to anything (its snap was never witnessed).
//
// The vault record's own id IS the commentId, on every attempt: it does not change between a
// first try and a later retry of the same held recording, so a lost response never turns into
// a second filed comment.
export async function sendHeld(store: VaultStore, send: typeof sendReaction = sendReaction): Promise<number> {
  let sent = 0
  for (const rec of await store.all()) {
    const snapId = snapIdOfKey(rec.noteId)
    if (!snapId || !rec.stopped || isEmpty(rec)) continue
    try {
      await send(snapId, audioOf(rec), rec.durationSec, rec.id)
      await forget(store, rec.id)
      sent += 1
    } catch {
      // Still held; the next visit tries again.
    }
  }
  return sent
}
