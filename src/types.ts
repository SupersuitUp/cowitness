// Cowitness's records. Every field is exactly as the app it was built in stores it, so an app moving onto this package reads and writes its existing records unchanged.
// `M` is the app's member key, stored in `by` and in hearts, and never renamed.
export type Member = string
export type MemberNames = Record<string, string>

// A recording on a message: a spoken reaction. The message's text is its transcript.
// `status` absent: the text is the transcript (or the app has no transcriber).
export interface Recording {
  path: string; contentType: string; durationSec: number; language?: string
  status?: 'transcribing' | 'failed'
  reason?: string
  // Stamped every time the recording moves to 'transcribing'; Try again measures staleness from here.
  startedAt?: string
}
export interface CommentImage { id: string; width: number; height: number }
// One message under a snap. Sent, never edited. `hearts` maps a member to when they hearted it.
export interface Comment<M extends string = string> {
  id: string; by: M; text: string; at: string
  hearts?: Partial<Record<M, string>>; recording?: Recording; quote?: string; images?: CommentImage[]
}
export type MediaKind = 'photo' | 'video'
export type VideoContentType = 'video/mp4' | 'video/quicktime'
export interface Chapter { startSec: number; at: string; thumbPath: string | null }
export interface VideoStream { dir: string; master: 'master.m3u8'; chapters: Chapter[] }
export interface VideoInfo {
  path: string; posterPath: string | null; durationSec: number; contentType: VideoContentType
  stream?: VideoStream
}
// What the app's upload pipeline produced, before it is a snap.
export interface FiledMedia {
  kind: MediaKind; takenAt: string; width: number; height: number
  paths: { original: string; display: string; thumb: string }
  video?: VideoInfo
}
// One photo or video one person shared to be witnessed. `witnessedAt` is the queue, the tile count
// and the receipt in one field. Nothing is ever deleted: whoever shared it can hide it.
export interface Snap<M extends string = string> {
  id: string; by: M; caption: string
  kind: MediaKind; takenAt: string; width: number; height: number
  paths: { original: string; display: string; thumb: string }
  video?: VideoInfo
  witnessedAt: string | null
  hiddenAt: string | null
  comments?: Comment<M>[]
  createdAt: string
}
export interface ChapterUrl { startSec: number; at: string; thumbUrl: string | null }
export interface MediaUrls {
  thumbUrl: string | null; displayUrl: string | null
  posterUrl?: string | null; videoUrl?: string
  streamUrl?: string; chapters?: ChapterUrl[]
}
export type SnapView<M extends string = string> = Snap<M> & MediaUrls
export type SnapPatch =
  | { kind: 'comment'; text: string; images?: CommentImage[] }
  | { kind: 'comment-heart'; commentId: string; value: boolean }
  | { kind: 'hide' }
  | { kind: 'unhide' }
  | { kind: 'witness'; text?: string }
export interface CowitnessSummary { count: number; coverUrl: string | null; hasNew: boolean; waiting: number }
