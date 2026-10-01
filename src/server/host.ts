import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { getStorage } from 'firebase-admin/storage'
import type { CowitnessFeatures, Person } from '../features.js'
import type { Comment, FiledMedia, MediaSnap, MediaUrls, PromptPerson, PromptSettings, Snap, SnapPatch, TagChoice } from '../types.js'

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
   * Which of the app's OWN errors are refusals whose words go back to a person, as the route's
   * answer or as a transcriber's stored reason. This package's own RuleError is always a refusal;
   * this check ADDS to that, so an error is never shown just because it carries a 4xx status. A
   * refusal answers with its `status` when that is 400-499 (403 when it has none); any other status
   * is treated as an internal error.
   *
   * Pass your pipeline's own refusal check here whenever `media.filePhoto`/`fileVideo` or
   * `transcription.transcribe` throw refusals of their own. The phone's resend depends on it: a Send
   * whose first answer was lost files the same id again, and only a 400/403/409 refusal from the
   * pipeline makes it ask whether the snap was already filed. Left out, that refusal becomes an
   * opaque 500, the retry fails, the person sends again, and a second snap is filed.
   */
  isRefusal?(err: unknown): boolean
  /**
   * Optional: where failures the person must not see are reported, such as an `announce` call that
   * throws after its snap or comment was saved. Without it those failures are dropped silently.
   */
  log?(message: string, err: unknown): void
  /** The list snaps are kept in. */
  collection: string
  /** Where spoken reactions are stored, `${prefix}snaps-audio/<snap>/<id>.<ext>`, and voice snaps, `${prefix}snaps-voice/<snap>.<ext>`. */
  storage: { bucket(): Bucket; prefix: string }
  media: {
    /** Signed URLs for one snap's photo or video (and, where the app has them, its stream and chapters). */
    urls(s: MediaSnap<M>): Promise<MediaUrls>
    /** A short-lived read URL for one stored file. */
    signedUrl(path: string): Promise<string>
    /**
     * The app's photo pipeline, filing an uploaded photo into `into`. `photoId` comes straight from
     * the request body and becomes the snap's id, so the package relies on this pipeline to:
     * check that the upload was issued to `m`; claim it exactly once; and refuse when `into.ref`
     * already exists. Without those checks a member could file over another member's snap or take
     * another member's upload. Throw those refusals as errors `isRefusal` recognises.
     */
    filePhoto(m: M, photoId: string, clientTakenAt: string | undefined, into: Destination<M>): Promise<Omit<Snap<M>, 'id'>>
    /** The app's video pipeline, filing an uploaded video into `into`. The same three duties as `filePhoto`. */
    fileVideo(m: M, photoId: string, meta: { durationSec: number; width: number; height: number; takenAt?: string }, into: Destination<M>): Promise<Omit<Snap<M>, 'id'>>
  }
  /**
   * The four moments. The app decides what each becomes; Cowitness never sends a push itself. Each
   * is called after the write is saved; a throw or a rejected promise goes to `log` and never
   * changes the route's answer.
   *
   * Every one is handed the snap, and a "just us" snap carries `justUs: true`. Before telling anyone,
   * the app MUST check each recipient with `mayHear(snap, person, circleOf(witnessing, people))`
   * (both exported from the package root); with no circle a "just us" snap may be told to its
   * author only. "Tell everyone but the actor" would put a private moment on a lock screen that
   * every route refuses to show.
   *
   * Pass a circle exactly when the package builds one: when `witnessing` is 'audience' or `justUs`
   * is on, made from `people()` as it reads now. With neither on, pass none. Never keep a circle
   * from before an option was turned off: a snap filed "just us" stays "just us", and an old circle
   * would tell someone who has since stopped sharing.
   */
  announce: {
    shared(m: M, s: Snap<M>): void
    witnessed(m: M, s: Snap<M>, firstWords: string): void
    message(m: M, s: Snap<M>, c: Comment<M>): void
    heart(m: M, s: Snap<M>, c: Comment<M>): void
    /** Optional: a spoken reaction was filed (its words arrive later). Without it, a spoken reaction is announced as nothing. */
    spoken?(m: M, s: Snap<M>, c: Comment<M>): void
    /** Optional: a snap's tags were set. `ids` is the full list now on the snap. */
    tagged?(m: M, s: Snap<M>, ids: string[]): void
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
  /** Which options are on. Absent: none, which is how the package behaved before options existed. */
  features?: Partial<CowitnessFeatures>
  /** Each person's part. Required when witnessing is 'audience' or justUs is on. */
  people?(): Promise<Person<M>[]>
  /** The list a snap is tagged from. Required when tags is on. `max` tags per snap, default 1. */
  tags?: { list(): Promise<TagChoice[]>; max?: number }
  /**
   * Capture reminders. Required when prompts is on. `collection` holds one claim per reminder sent
   * (its id is the reminder's `<day>@<HH:MM>`), so two overlapping runs never send one twice.
   * `people` are the people reminded, with their own times; `save` stores one person's times;
   * `nudge` is what a reminder becomes (a push, in most apps). The package never sends one itself.
   */
  prompts?: {
    collection: string
    timeZone: string
    people(): Promise<PromptPerson<M>[]>
    save(m: M, s: PromptSettings): Promise<void>
    nudge(m: M, slotKey: string): void | Promise<void>
  }
}
