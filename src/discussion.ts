import { RuleError } from './errors.js'

// Shared by passage conversations, whole-item conversations and witness sessions. The host
// supplies anchor equality; this layer never knows a tile, a route, a database or a member list.
export const DISCUSSION_EMOJIS = ['❤️', '😂', '🥹', '😮', '🔥', '🙏'] as const
export function appendCommentOnce<C extends { id: string; by: string; text: string }>(
  comments: C[], proposed: C, sameAnchor: (a: C, b: C) => boolean = () => true,
): { comments: C[]; changed: boolean } {
  const existing = comments.find((c) => c.id === proposed.id)
  if (!existing) return { comments: [...comments, proposed], changed: true }
  if (existing.by !== proposed.by || existing.text !== proposed.text || !sameAnchor(existing, proposed)) {
    throw new RuleError('that request id was already used', 409)
  }
  return { comments, changed: false }
}

export function setEmojiReaction<R extends { by: string; emoji: string }>(
  reactions: R[], proposed: R, value: boolean, sameAnchor: (a: R, b: R) => boolean = () => true,
): { reactions: R[]; changed: boolean } {
  const same = (r: R) => r.by === proposed.by && r.emoji === proposed.emoji && sameAnchor(r, proposed)
  if (reactions.some(same) === value) return { reactions, changed: false }
  return { reactions: value ? [...reactions, proposed] : reactions.filter((r) => !same(r)), changed: true }
}
