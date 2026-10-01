import { RuleError, parseCommentHeart, parseCommentBody, validateVideoDims, localTakenAt } from '../shared-rules.js'
import type { SnapPatch } from '../types.js'

const id = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new RuleError(`${name} is required`, 400)
  return v
}

// The caption is passed through untouched; validateCaption in the store is its one judge.
export function parseSnapPhotoBody(body: unknown): { photoId: string; caption?: unknown; clientTakenAt?: string } {
  const b = (body ?? {}) as Record<string, unknown>
  return {
    photoId: id(b.photoId, 'photoId'),
    caption: b.caption,
    clientTakenAt: typeof b.clientTakenAt === 'string' ? b.clientTakenAt : undefined,
  }
}

export function parseSnapVideoBody(body: unknown): {
  photoId: string; caption?: unknown; meta: { durationSec: number; width: number; height: number; takenAt?: string }
} {
  const b = (body ?? {}) as Record<string, unknown>
  const photoId = id(b.photoId, 'photoId')
  const dims = validateVideoDims({ durationSec: b.durationSec, width: b.width, height: b.height })
  return { photoId, caption: b.caption, meta: { ...dims, takenAt: localTakenAt(b.takenAt) } }
}

export function parseSnapPatch(body: unknown): SnapPatch {
  const b = (body ?? {}) as { kind?: unknown; text?: unknown; commentId?: unknown; value?: unknown; images?: unknown }
  switch (b.kind) {
    case 'comment':
      return parseCommentBody(b)
    case 'comment-heart':
      return parseCommentHeart(b)
    case 'hide':
      return { kind: 'hide' }
    case 'unhide':
      return { kind: 'unhide' }
    case 'witness':
      if (b.text !== undefined && typeof b.text !== 'string') throw new RuleError('text must be a string', 400)
      return typeof b.text === 'string' ? { kind: 'witness', text: b.text } : { kind: 'witness' }
    default:
      throw new RuleError('unknown patch kind', 400)
  }
}
