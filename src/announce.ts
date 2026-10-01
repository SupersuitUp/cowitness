import type { Comment, Snap, SnapPatch } from './types.js'

// Which of the four moments the app is told about a write is, decided here so every app hears the
// same thing and words it its own way (a push, an Activity row, an email line).
// Sharing is announced by the filing route itself.
export type Announcement<M extends string = string> =
  | { kind: 'message'; comment: Comment<M> }
  | { kind: 'heart'; comment: Comment<M> }
  | { kind: 'witnessed'; firstWords: string }

export function announcementOf<M extends string>(m: M, snap: Snap<M>, patch: SnapPatch, now: string): Announcement<M> | null {
  if (patch.kind === 'comment') {
    const c = snap.comments?.at(-1)
    return c && c.by === m ? { kind: 'message', comment: c } : null
  }
  if (patch.kind === 'comment-heart' && patch.value) {
    // Only the request that set the heart is news: a second tap keeps the first stamp.
    const c = (snap.comments ?? []).find((x) => x.id === patch.commentId)
    return c && c.by !== m && c.hearts?.[m] === now ? { kind: 'heart', comment: c } : null
  }
  if (patch.kind === 'witness') {
    // Only the request that set witnessedAt is news; the stamp is the route's `now`.
    return snap.witnessedAt === now ? { kind: 'witnessed', firstWords: patch.text?.trim() ?? '' } : null
  }
  // Un-hearting, hiding and bringing back are never news.
  return null
}
