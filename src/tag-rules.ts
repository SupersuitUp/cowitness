import { RuleError } from './errors.js'
import type { Snap } from './types.js'

// Tags come from a list the app supplies (for example, the firsts a household is waiting for).
// A snap carries at most `max` of them, default one.
export const TAGS_MAX_DEFAULT = 1

export function validateTags(v: unknown, valid: ReadonlySet<string> | undefined, max: number): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!valid) throw new RuleError('tags are not on here', 400)
  if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) throw new RuleError('tags must be a list of ids', 400)
  const ids = [...new Set(v as string[])]
  if (ids.length > max) throw new RuleError(`at most ${max} tag${max === 1 ? '' : 's'}`, 400)
  if (ids.some((t) => !valid.has(t))) throw new RuleError('unknown tag', 400)
  return ids.length ? ids : undefined
}

// "Just us" is stored only as true; off is the key's absence, so an old record and an unmarked one
// read the same.
export function validateJustUs(v: unknown, on: boolean): true | undefined {
  if (v === undefined || v === null || v === false) return undefined
  if (v !== true) throw new RuleError('justUs must be true or false', 400)
  if (!on) throw new RuleError('"just us" is not on here', 400)
  return true
}

// The tags a tag patch should announce: the new set, only when it differs from the old one and is
// not empty. Re-tagging with the same tags, or clearing them, announces nothing.
export function tagsToAnnounce(before: Pick<Snap, 'tags'>, after: Pick<Snap, 'tags'>): string[] | undefined {
  const next = after.tags ?? []
  if (!next.length) return undefined
  const prev = before.tags ?? []
  const same = prev.length === next.length && next.every((t) => prev.includes(t))
  return same ? undefined : next
}
