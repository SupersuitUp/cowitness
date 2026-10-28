import { RuleError } from './errors.js'

// Shared by passage conversations, whole-item conversations and witness sessions. The host
// supplies anchor equality; this layer never knows a tile, a route, a database or a member list.
export const DISCUSSION_EMOJIS = ['❤️', '😂', '🥹', '😮', '🔥', '🙏'] as const

// The six above are the quick picks a host shows first. Any other single emoji is allowed too
// (us-template#7: "Please allow any emoji to be submitted"), so the rule every host enforces is
// this one rather than membership in that list. One grapheme only: a flag pair, a keycap, or one
// pictograph with its skin tone, variation selector, tag letters and ZWJ-joined parts. Letters,
// words, spaces and two emoji in a row are refused, and the length cap keeps a stored key small.
const EMOJI_PART = String.raw`(?!\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|[\u{1F3FB}-\u{1F3FF}]|[\u{E0020}-\u{E007F}])*`
const SINGLE_EMOJI = new RegExp(String.raw`^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|${EMOJI_PART}(?:‍${EMOJI_PART})*)$`, 'u')
export const EMOJI_MAX_LENGTH = 32
export function isSingleEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > EMOJI_MAX_LENGTH || !SINGLE_EMOJI.test(value)) return false
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  return !Seg || [...new Seg(undefined, { granularity: 'grapheme' }).segment(value)].length === 1
}
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
