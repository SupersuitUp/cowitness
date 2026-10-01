import type { Member } from './shim.js'

// A recording on a message: a voice reaction in Cowitness. The message's text is its transcript.
// `status` absent: the text is the transcript (or there is none yet, pre-Stage-4).
export interface Recording {
  path: string; contentType: string; durationSec: number; language?: string
  status?: 'transcribing' | 'failed'
  reason?: string
  // Stamped every time the recording moves to 'transcribing' (auto or Try again). Staleness for
  // Try again is measured from here, not from the comment's own `at`, so a reaction filed long
  // ago whose transcription genuinely just started is still protected from a racing retry.
  startedAt?: string
}

// One message in the conversation under a photo or poem. Sent, never edited. `hearts` maps a
// member to when they hearted it; only the other member can heart a message. `quote` is the
// passage of a note the message answers, copied at send time so an edit never re-points it.
// A picture sent in a message: its id in us_comment_images and its size, for laying it out before
// it loads. The bytes are served only through a check of who can see what it was sent under.
export interface CommentImage { id: string; width: number; height: number }

export interface Comment { id: string; by: Member; text: string; at: string; hearts?: Partial<Record<Member, string>>; recording?: Recording; quote?: string; images?: CommentImage[] }

export type MediaKind = 'photo' | 'video'

export type VideoContentType = 'video/mp4' | 'video/quicktime'

// One chapter marker on an adaptive stream: where it starts, when it was cut, and its
// thumbnail if one was generated. `thumbPath` is null until the thumbnail exists.
export interface Chapter { startSec: number; at: string; thumbPath: string | null }

// The adaptive-streaming files for a video, once transcoded: HLS renditions under `dir`,
// always fronted by `master.m3u8`, plus its chapter markers.
export interface VideoStream { dir: string; master: 'master.m3u8'; chapters: Chapter[] }

export interface VideoInfo {
  path: string; posterPath: string | null; durationSec: number; contentType: VideoContentType
  stream?: VideoStream
}

// What filing an upload produced, before it is a photo in a moment or a snap: the same bytes,
// the same keys, the same claim. Built by filePhoto / fileVideo in store.ts.
export interface FiledMedia {
  kind: MediaKind; takenAt: string; width: number; height: number
  paths: { original: string; display: string; thumb: string }
  video?: VideoInfo
}

// A snap in Cowitness: one photo or video one member posted for the other to witness. Kept in
// its own collection (us_snaps) because Photos is a curated album of moments and this is a
// running feed. `witnessedAt` is the queue, the tile count and the receipt in one field.
// Nothing is ever deleted: the member who posted it can hide it, and only they see it then.
export interface Snap {
  id: string; by: Member; caption: string
  kind: MediaKind; takenAt: string; width: number; height: number
  paths: { original: string; display: string; thumb: string }
  video?: VideoInfo
  witnessedAt: string | null
  hiddenAt: string | null
  comments?: Comment[]
  createdAt: string
}

export type SnapPatch =
  | { kind: 'comment'; text: string; images?: CommentImage[] }
  | { kind: 'comment-heart'; commentId: string; value: boolean }
  | { kind: 'hide' }
  | { kind: 'unhide' }
  | { kind: 'witness'; text?: string }

export interface CowitnessSummary { count: number; coverUrl: string | null; hasNew: boolean; waiting: number }
