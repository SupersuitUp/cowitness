// Pure helpers for Cowitness screens. Kept out of any 'use client' file because the server
// render calls snapRow(), and a function exported from a client module cannot be called there.
import type { Member } from './types.js'
import type { Snap, SnapKind } from './types.js'

export interface SnapRow {
  id: string; by: Member; caption: string; kind: SnapKind
  thumbUrl: string | null; durationSec: number | null
  createdAt: string; witnessedAt: string | null; hidden: boolean
}

// `thumbUrl` is passed in rather than read off a SnapView, so a caller signs only the one image
// a tile shows, and a row the page never draws (the streak's) signs nothing.
export function snapRow(s: Snap, thumbUrl: string | null = null): SnapRow {
  return {
    id: s.id, by: s.by, caption: s.caption, kind: s.kind,
    thumbUrl, durationSec: s.kind === 'video' && s.video ? s.video.durationSec : null,
    createdAt: s.createdAt, witnessedAt: s.witnessedAt, hidden: s.hiddenAt !== null,
  }
}
