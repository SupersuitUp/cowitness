import 'server-only'
import { after } from 'next/server'
import { announcementOf } from '../announce.js'
import { RuleError, isRuleError } from '../errors.js'
import { DEFAULT_FEATURES } from '../features.js'
import { validateCommentId } from '../snap-rules.js'
import { tagsToAnnounce } from '../tag-rules.js'
import type { Snap, SnapPatch } from '../types.js'
import type { CowitnessHost } from './host.js'
import { handle as handleWith } from './http.js'
import { parseSnapPatch, parseSnapPhotoBody, parseSnapVideoBody } from './parse.js'
import { createCowitnessStore, type CowitnessStore } from './store.js'

type IdParams = { params: Promise<{ id: string }> }
type ReactionParams = { params: Promise<{ id: string; commentId: string }> }

// The handlers an app mounts at its own addresses, one line per route file. Moved from the route
// files of the app it was built in (see scripts/port/task12.json). Each route file still declares its own segment
// config (`runtime = 'nodejs'`, and `maxDuration = 300` on the two that transcribe), because Next.js
// reads those from the route file itself.
export function createCowitnessHandlers<M extends string>(host: CowitnessHost<M>, store: CowitnessStore<M> = createCowitnessStore(host)) {
  // The options are the store's, so routes paired with a prebuilt store answer as that store does.
  // A stand-in store that carries none runs with every option off.
  const features = store.features ?? DEFAULT_FEATURES
  // The host's own refusals ADD to the package's: a RuleError always reaches the client with its words.
  const handle = (fn: () => Promise<Response>) => handleWith(fn, (err) => isRuleError(err) || host.isRefusal?.(err) === true)
  const signedIn = async (req?: Request): Promise<M> => {
    const m = await host.member(req)
    if (!m) throw new RuleError('private', 403)
    return m
  }
  // An announcement runs after the write is committed, so its failure must never turn a saved snap
  // or comment into an error: the phone would send it again and file it twice. A throw, or a
  // promise that rejects later, goes to the host's log when it has one and is otherwise dropped.
  const quietly = (what: string, announce: () => unknown) => {
    const failed = (err: unknown) => { try { host.log?.(`announce ${what} failed`, err) } catch { /* a log that throws is dropped too */ } }
    try {
      const r = announce() as { then?: unknown } | undefined
      if (r && typeof r.then === 'function') (r as Promise<unknown>).then(undefined, failed)
    } catch (err) { failed(err) }
  }
  const tell = (m: M, snap: Snap<M>, patch: SnapPatch, now: string, before?: Snap<M>) => {
    const a = announcementOf(m, snap, patch, now, features.witnessing)
    if (!a) return
    if (a.kind === 'message') quietly('message', () => host.announce.message(m, snap, a.comment))
    else if (a.kind === 'heart') quietly('heart', () => host.announce.heart(m, snap, a.comment))
    else if (a.kind === 'witnessed') quietly('witnessed', () => host.announce.witnessed(m, snap, a.firstWords))
    else if (a.kind === 'tagged') {
      // Only a change to a set that is not empty is news: the same tags again, or none, say nothing.
      const ids = tagsToAnnounce(before ?? {}, snap)
      if (ids && host.announce.tagged) quietly('tagged', () => host.announce.tagged!(m, snap, ids))
    }
  }
  // A snap filed with tags is announced as tagged too, after it is announced as shared.
  const filed = (m: M, snap: Snap<M>) => {
    quietly('shared', () => host.announce.shared(m, snap))
    const ids = snap.tags
    if (ids?.length && host.announce.tagged) quietly('tagged', () => host.announce.tagged!(m, snap, ids))
  }

  return {
    // The archive: everything this person can see, newest first, with signed media.
    snaps: {
      GET: (req?: Request) => handle(async () => Response.json(await store.listSnaps(await signedIn(req)))),
    },
    // Body: { photoId, caption?, clientTakenAt? }. The bytes went up on the app's own photo ticket.
    photo: {
      POST: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        const { photoId, caption, clientTakenAt, ...extra } = parseSnapPhotoBody(await req.json())
        const snap = await store.finalizeSnapPhoto(m, photoId, { caption, clientTakenAt, ...extra })
        filed(m, snap)
        return Response.json(snap)
      }),
    },
    // Body: { photoId, caption?, durationSec, width, height, takenAt? }.
    video: {
      POST: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        const { photoId, caption, meta, ...extra } = parseSnapVideoBody(await req.json())
        const snap = await store.finalizeSnapVideo(m, photoId, { caption, meta, ...extra })
        filed(m, snap)
        return Response.json(snap)
      }),
    },
    snap: {
      GET: (req: Request, { params }: IdParams) => handle(async () => {
        const snap = await store.getSnapView(await signedIn(req), (await params).id)
        if (!snap) return Response.json({ error: 'not found' }, { status: 404 })
        return Response.json(snap)
      }),
      // `now` is decided here so the stamp on a heart or a witness is the one the announcement checks.
      PATCH: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        const id = (await params).id
        // With an option off its patch is refused with the words it always had, before the store is touched.
        const parsed = parseSnapPatch(await req.json(), { tags: features.tags, justUs: features.justUs })
        const patch = host.commentImages ? await host.commentImages.claim(m, parsed) : parsed
        const now = new Date().toISOString()
        let before: Snap<M> | undefined
        const snap = await store.patchSnap(m, id, patch, patch.kind === 'tag' ? { now, before: (s) => { before = s } } : { now })
        // The comment is saved. Attaching its pictures is the app's bookkeeping, and a failure there
        // must not turn a saved comment into an error: the phone would send it again.
        if (host.commentImages) {
          try { await host.commentImages.attach(patch, { collection: 'snaps', id }, snap.comments) }
          catch (err) { try { host.log?.('commentImages.attach failed', err) } catch { /* a log that throws is dropped too */ } }
        }
        tell(m, snap, patch, now, before)
        return Response.json(snap)
      }),
    },
    // Body: { commentId, contentType, durationSec }. The bytes are already in storage. The words
    // are written in after the response has gone, and only when this attach created the reaction.
    reactions: {
      POST: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        const { id } = await params
        const body = (await req.json()) as { commentId: unknown; contentType: unknown; durationSec: unknown }
        const commentId = validateCommentId(body.commentId)
        const { snap, created } = await store.attachReaction(m, id, body)
        if (created && host.announce.spoken) {
          const c = snap.comments?.find((x) => x.id === commentId)
          if (c) quietly('spoken', () => host.announce.spoken!(m, snap, c))
        }
        if (created && host.transcription) {
          after(async () => {
            try { await store.transcribeReaction(id, commentId) } catch (err) { console.error('reaction transcription failed', err) }
          })
        }
        return Response.json(snap)
      }),
    },
    // Body: { contentType, size, durationSec, commentId }. The PUT must send exactly `requiredHeaders`.
    reactionUploadUrl: {
      POST: (req: Request, { params }: IdParams) => handle(async () => {
        const m = await signedIn(req)
        const body = (await req.json()) as { contentType: unknown; size: unknown; durationSec: unknown; commentId: unknown }
        return Response.json(await store.reactionUploadUrl(m, (await params).id, body))
      }),
    },
    // Listen: a short-lived signed URL, behind the member check.
    reactionAudio: {
      GET: (req: Request, { params }: ReactionParams) => handle(async () => {
        const m = await signedIn(req)
        const { id, commentId } = await params
        return Response.redirect(await store.reactionAudioUrl(m, id, commentId), 302)
      }),
    },
    // A person's own reminder times and "not today". The app runs sendDuePrompts from its own timer.
    prompts: {
      GET: (req: Request) => handle(async () => Response.json(await store.promptSettings(await signedIn(req)))),
      PATCH: (req: Request) => handle(async () => {
        const m = await signedIn(req)
        return Response.json(await store.savePromptSettings(m, await req.json()))
      }),
    },
    // Body: { language? }. Transcribes a reaction that is already filed, again. No re-recording.
    reactionTranscribe: {
      POST: (req: Request, { params }: ReactionParams) => handle(async () => {
        const m = await signedIn(req)
        const { id, commentId } = await params
        const { language } = (await req.json().catch(() => ({}))) as { language?: unknown }
        return Response.json(await store.retranscribeReaction(m, id, commentId, language))
      }),
    },
  }
}

export type CowitnessHandlers<M extends string> = ReturnType<typeof createCowitnessHandlers<M>>
