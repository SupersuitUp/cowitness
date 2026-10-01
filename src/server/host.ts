import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { getStorage } from 'firebase-admin/storage'
import type { Comment, FiledMedia, MediaUrls, Snap, SnapPatch } from '../types.js'

// The bucket type comes from firebase-admin's own surface: @google-cloud/storage is its transitive
// dependency, and pnpm does not hoist it, so importing it directly would not resolve in every app.
export type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>

// Where the app's upload pipeline files a snap: the record's reference, and how to build the
// record from what the pipeline produced.
export interface Destination<M extends string> {
  ref: DocumentReference
  record(media: FiledMedia): Omit<Snap<M>, 'id'>
}

// Everything the app hands Cowitness. The module knows how the feature works; the app says who
// the people are, where things are kept, and what each moment becomes for the people told.
export interface CowitnessHost<M extends string> {
  /** Who is signed in for this request, or null for a stranger. */
  member(req?: Request): Promise<M | null>
  /** Called on use, never at import, so building an app needs no credentials. */
  db(): Firestore
  /**
   * Whether an error is a refusal whose message goes back to a person (the transcriber's stored
   * reason). Defaults to this package's own RuleError only; an app with refusals of its own passes
   * its own check, so an error is never shown just because it carries a 4xx status.
   */
  isRefusal?(err: unknown): boolean
  /** The list snaps are kept in. */
  collection: string
  /** Where spoken reactions are stored: `${prefix}snaps-audio/<snap>/<id>.<ext>`. */
  storage: { bucket(): Bucket; prefix: string }
  media: {
    /** Signed URLs for one snap's photo or video (and, where the app has them, its stream and chapters). */
    urls(s: Snap<M>): Promise<MediaUrls>
    /** A short-lived read URL for one stored file. */
    signedUrl(path: string): Promise<string>
    /** The app's photo pipeline, filing an uploaded photo into `into`. */
    filePhoto(m: M, photoId: string, clientTakenAt: string | undefined, into: Destination<M>): Promise<Omit<Snap<M>, 'id'>>
    /** The app's video pipeline, filing an uploaded video into `into`. */
    fileVideo(m: M, photoId: string, meta: { durationSec: number; width: number; height: number; takenAt?: string }, into: Destination<M>): Promise<Omit<Snap<M>, 'id'>>
  }
  /** The four moments. The app decides what each becomes; Cowitness never sends a push itself. */
  announce: {
    shared(m: M, s: Snap<M>): void
    witnessed(m: M, s: Snap<M>, firstWords: string): void
    message(m: M, s: Snap<M>, c: Comment<M>): void
    heart(m: M, s: Snap<M>, c: Comment<M>): void
  }
  /** Pictures sent in a snap's messages, kept by the app with every other conversation's pictures. */
  commentImages?: {
    claim(m: M, patch: SnapPatch): Promise<SnapPatch>
    attach(patch: SnapPatch, parent: { collection: 'snaps'; id: string }, comments: Comment<M>[] | undefined): Promise<void>
  }
  /** Optional: without it, spoken reactions stay playable with no words under them. */
  transcription?: {
    /** The languages a speaker may name; anything else is 'auto'. */
    languages: readonly string[]
    transcribe(audio: Buffer, contentType: string, opts: { language: string; speaker: M }): Promise<string>
  }
}
