import type { Comment, Snap, SnapPatch } from './types.js'
import type { Witnessing } from './features.js'

// Which of the four moments the app is told about a write is, decided here so every app hears the
// same thing and words it its own way (a push, an Activity row, an email line).
// Sharing is announced by the filing route itself.
export type Announcement<M extends string = string> =
  | { kind: 'message'; comment: Comment<M> }
  | { kind: 'heart'; comment: Comment<M> }
  | { kind: 'witnessed'; firstWords: string }
  | { kind: 'tagged'; ids: string[] }

export function announcementOf<M extends string>(
  m: M, snap: Snap<M>, patch: SnapPatch, now: string, witnessing: Witnessing = 'each-other',
): Announcement<M> | null {
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
    // Only the request that set the stamp is news; the stamp is the route's `now`. In the audience
    // kind each witness has their own.
    const stamped = witnessing === 'audience' ? snap.witnessedBy?.[m] === now : snap.witnessedAt === now
    return stamped ? { kind: 'witnessed', firstWords: patch.text?.trim() ?? '' } : null
  }
  if (patch.kind === 'tag') return { kind: 'tagged', ids: snap.tags ?? [] }
  // Un-hearting, hiding and bringing back are never news.
  return null
}
