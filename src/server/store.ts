import 'server-only'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { RuleError, isRuleError } from '../errors.js'
import { CLIP_MAX_BYTES } from '../shared-rules.js'
import {
  addVoiceReaction, applySnapPatch, archiveOf, canAutoTranscribe, canRetranscribe, canSeeSnap, coverOf, cowitnessTile,
  failReactionTranscript, markTranscribing, newSnap, openOf, queueOf, reactionAudioPath, reactionTicket,
  setReactionTranscript, thumbPathOf, validateCaption, validateCommentId, validateReactionClip, witnessedOf, type ReactionTicket,
} from '../snap-rules.js'
import { snapRow, type SnapRow } from '../format.js'
import { spokenLanguage } from '../language.js'
import { parsePromptPatch, promptsDue } from '../prompts.js'
import { zoned } from '../zoned.js'
import { resolveFeatures, type CowitnessFeatures } from '../features.js'
import type { CowitnessSummary, MediaSnap, PromptSettings, Recording, Snap, SnapPatch, SnapView } from '../types.js'
import type { CowitnessHost } from './host.js'

// Cowitness at the edge: read, call one rule, write. Every decision is in ../snap-rules.ts.
// Moved from the app it was built in; what was that app's own (the database, the bucket, the
// media pipeline, the transcriber) is now asked of the host.
const REACTION_UPLOAD_WINDOW_MS = 15 * 60 * 1000
const nowIso = () => new Date().toISOString()

// An option the app turned on without the part it needs would fail on a person's first tap; it
// fails here instead, when the app starts, naming what is missing.
// A part that is there but the wrong shape (a host written without types) is refused the same way.
export function assertHostFits<M extends string>(host: CowitnessHost<M>, f: CowitnessFeatures): void {
  const missing: string[] = []
  const isFn = (v: unknown) => typeof v === 'function'
  const isText = (v: unknown) => typeof v === 'string' && v.length > 0
  if ((f.witnessing === 'audience' || f.justUs) && !isFn(host.people)) missing.push('people() (for the audience kind or "just us")')
  if (f.tags) {
    if (!isFn(host.tags?.list)) missing.push('tags.list() (for tags)')
    const max = host.tags?.max
    if (max !== undefined && !(Number.isInteger(max) && max > 0)) missing.push('tags.max as a whole number above 0 (for tags)')
  }
  if (f.prompts) {
    const p = host.prompts as Partial<NonNullable<CowitnessHost<M>['prompts']>> | undefined
    if (!p || typeof p !== 'object') missing.push('prompts (for capture reminders)')
    else {
      if (!isText(p.collection)) missing.push('prompts.collection (for capture reminders)')
      if (!isText(p.timeZone)) missing.push('prompts.timeZone (for capture reminders)')
      for (const fn of ['people', 'save', 'nudge'] as const) if (!isFn(p[fn])) missing.push(`prompts.${fn}() (for capture reminders)`)
    }
  }
  if (missing.length) throw new Error(`cowitness: the host turned on options without ${missing.join(', ')}`)
}

export function createCowitnessStore<M extends string>(host: CowitnessHost<M>) {
  const features = resolveFeatures(host.features)
  assertHostFits(host, features)
  const snaps = () => host.db().collection(host.collection)
  const snapFrom = (doc: DocumentSnapshot): Snap<M> => ({ id: doc.id, ...(doc.data() as Omit<Snap<M>, 'id'>) })
  const withUrls = async (s: Snap<M>): Promise<SnapView<M>> => ({ ...s, ...(await host.media.urls(s as MediaSnap<M>)) })
  // The one image a tile shows, signed alone; a row the page never draws (the streak's) signs nothing.
  const tileRow = async (s: Snap<M>): Promise<SnapRow> => {
    const path = thumbPathOf(s)
    return snapRow(s, path ? await host.media.signedUrl(path) : null)
  }
  const audioFile = (snapId: string, commentId: string, contentType: string) =>
    host.storage.bucket().file(reactionAudioPath(host.storage.prefix, snapId, commentId, contentType))

  // The photo went up on the app's own upload ticket, exactly as an album photo does; this files it
  // as a snap. The caption is checked first, so a bad one never costs the ticket.
  async function finalizeSnapPhoto(m: M, photoId: string, input: { caption?: unknown; clientTakenAt?: string }): Promise<Snap<M>> {
    const caption = validateCaption(input.caption)
    const ref = snaps().doc(photoId)
    const data = await host.media.filePhoto(m, photoId, input.clientTakenAt, { ref, record: (media) => newSnap(m, media, caption, nowIso()) as Omit<Snap<M>, 'id'> })
    return { id: photoId, ...data }
  }

  async function finalizeSnapVideo(
    m: M, photoId: string, input: { caption?: unknown; meta: { durationSec: number; width: number; height: number; takenAt?: string } },
  ): Promise<Snap<M>> {
    const caption = validateCaption(input.caption)
    const ref = snaps().doc(photoId)
    const data = await host.media.fileVideo(m, photoId, input.meta, { ref, record: (media) => newSnap(m, media, caption, nowIso()) as Omit<Snap<M>, 'id'> })
    return { id: photoId, ...data }
  }

  // A few snaps a day between a few people: one read, filtered here, no composite index.
  async function readSnaps(): Promise<Snap<M>[]> {
    const q = await snaps().get()
    return q.docs.map(snapFrom)
  }

  async function listSnaps(m: M): Promise<SnapView<M>[]> {
    return Promise.all(archiveOf(await readSnaps(), m).map(withUrls))
  }

  // Everything the Cowitness home draws, from ONE read of the list.
  async function listCowitness(m: M): Promise<{ rows: SnapRow[]; streak: SnapRow[]; witnessed: number; queue: SnapView<M>[] }> {
    const all = await readSnaps()
    const [rows, queue] = await Promise.all([Promise.all(openOf(all, m).map(tileRow)), Promise.all(queueOf(all, m).map(withUrls))])
    return { rows, queue, streak: archiveOf(all, m).map((s) => snapRow(s)), witnessed: witnessedOf(all, m).length }
  }

  async function listWitnessed(m: M): Promise<SnapRow[]> {
    return Promise.all(witnessedOf(await readSnaps(), m).map(tileRow))
  }

  async function getSnapView(m: M, id: string): Promise<SnapView<M> | null> {
    const doc = await snaps().doc(id).get()
    if (!doc.exists) return null
    const s = snapFrom(doc)
    return canSeeSnap(s, m) ? withUrls(s) : null
  }

  // Read-apply-write, shared by every mutation. `update` throws to refuse.
  async function rewrite(id: string, update: (s: Snap<M>) => Snap<M>): Promise<Snap<M>> {
    const ref = snaps().doc(id)
    return host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new RuleError('snap not found', 404)
      const updated = update(snapFrom(doc))
      const { id: _id, ...data } = updated
      tx.set(ref, data)
      return updated
    })
  }

  async function patchSnap(m: M, id: string, patch: SnapPatch, opts: { now?: string } = {}): Promise<Snap<M>> {
    return rewrite(id, (s) => {
      // A hidden snap the caller cannot see answers exactly like one that does not exist.
      if (!canSeeSnap(s, m)) throw new RuleError('snap not found', 404)
      return applySnapPatch(s, m, patch, opts) as Snap<M>
    })
  }

  async function listQueue(m: M): Promise<SnapView<M>[]> {
    return Promise.all(queueOf(await readSnaps(), m).map(withUrls))
  }

  async function cowitnessSummary(m: M, lastSeenAt: string): Promise<CowitnessSummary> {
    const all = await readSnaps()
    const cover = coverOf(all, m)
    const coverUrl = cover ? await host.media.signedUrl(cover.paths.thumb) : null
    return cowitnessTile(all, m, lastSeenAt, coverUrl)
  }

  async function visibleSnap(m: M, id: string): Promise<Snap<M>> {
    const doc = await snaps().doc(id).get()
    if (!doc.exists) throw new RuleError('snap not found', 404)
    const s = snapFrom(doc)
    if (!canSeeSnap(s, m)) throw new RuleError('snap not found', 404)
    return s
  }

  // The signed PUT a reaction goes up with, straight to storage (a request body over 4.5 MB never
  // reaches a route). The id comes from the phone's own vault record, so a resend reuses it, and if
  // the bytes are already there nothing is signed at all: a second create-once PUT would only 412.
  async function reactionUploadUrl(
    m: M, snapId: string, input: { contentType: unknown; size: unknown; durationSec: unknown; commentId: unknown },
  ): Promise<ReactionTicket> {
    const { contentType } = validateReactionClip(input)
    const commentId = validateCommentId(input.commentId)
    await visibleSnap(m, snapId)
    const file = audioFile(snapId, commentId, contentType)
    const [exists] = await file.exists()
    if (exists) return reactionTicket(commentId, true, '', {})
    const extensionHeaders = { 'x-goog-content-length-range': `0,${CLIP_MAX_BYTES}`, 'x-goog-if-generation-match': '0' }
    const [url] = await file.getSignedUrl({
      version: 'v4', action: 'write', expires: Date.now() + REACTION_UPLOAD_WINDOW_MS, contentType, extensionHeaders,
    })
    return reactionTicket(commentId, false, url, { 'Content-Type': contentType, ...extensionHeaders })
  }

  // The recording is in storage; file it under the snap as a message. Idempotent by id, and
  // `created` tells the route whether to schedule a transcription at all.
  async function attachReaction(
    m: M, snapId: string, input: { commentId: unknown; contentType: unknown; durationSec: unknown },
  ): Promise<{ snap: Snap<M>; created: boolean }> {
    const commentId = validateCommentId(input.commentId)
    const ct = typeof input.contentType === 'string' ? input.contentType.split(';')[0].trim() : ''
    const file = audioFile(snapId, commentId, ct)
    const [exists] = await file.exists()
    if (!exists) throw new RuleError('that recording did not finish uploading', 404)
    const [md] = await file.getMetadata()
    const { contentType, durationSec } = validateReactionClip({ contentType: ct, size: Number(md.size), durationSec: input.durationSec })
    // With no transcriber the recording is filed settled: playable, with no words to wait for.
    const rec: Recording = { path: file.name, contentType, durationSec, ...(host.transcription ? { status: 'transcribing' as const } : {}) }
    let created = false
    const snap = await rewrite(snapId, (s) => {
      created = !(s.comments ?? []).some((c) => c.id === commentId)
      return addVoiceReaction(s, m, commentId, rec, { now: nowIso() }) as Snap<M>
    })
    return { snap, created }
  }

  async function reactionAudioUrl(m: M, snapId: string, commentId: string): Promise<string> {
    const s = await visibleSnap(m, snapId)
    const rec = s.comments?.find((c) => c.id === commentId)?.recording
    if (!rec) throw new RuleError('recording not found', 404)
    return host.media.signedUrl(rec.path)
  }

  const transcriber = () => {
    if (!host.transcription) throw new RuleError('transcription is not available', 404)
    return host.transcription
  }

  // The model call and the write of what came back, shared by the auto path and Try again. Both
  // callers marked the recording 'transcribing' in their own transaction first.
  async function finishTranscription(snapId: string, commentId: string, marked: Snap<M>, language: string): Promise<Snap<M>> {
    const t = transcriber()
    const c = (marked.comments ?? []).find((x) => x.id === commentId)!
    const rec = c.recording!
    let words: string
    try {
      const file = host.storage.bucket().file(rec.path)
      const [exists] = await file.exists()
      if (!exists) throw new RuleError('that recording is no longer in storage', 404)
      const [audio] = await file.download()
      words = await t.transcribe(audio, rec.contentType, { language, speaker: c.by })
    } catch (err) {
      console.error(`transcribeReaction: ${rec.path}`, err)
      // A refusal written for a reader (ours or the transcriber's own) keeps its words.
      const reason = (isRuleError(err) || host.isRefusal?.(err) === true) ? (err as Error).message : 'the recording could not be made out'
      return rewrite(snapId, (s) => failReactionTranscript(s, commentId, reason) as Snap<M>)
    }
    return rewrite(snapId, (s) => setReactionTranscript(s, commentId, words) as Snap<M>)
  }

  // The AUTO path, scheduled by the attach route right after it creates a reaction. A no-op unless
  // the recording is still exactly as attachReaction left it, so it can never run twice over one.
  async function transcribeReaction(snapId: string, commentId: string, language?: unknown): Promise<Snap<M>> {
    const lang = spokenLanguage(language, transcriber().languages)
    let ran = true
    const marked = await rewrite(snapId, (s) => {
      const c = (s.comments ?? []).find((x) => x.id === commentId)
      if (!c?.recording) throw new RuleError('reaction not found', 404)
      if (!canAutoTranscribe(c.recording)) { ran = false; return s }
      return markTranscribing(s, commentId, lang === 'auto' ? undefined : lang, { now: nowIso() }) as Snap<M>
    })
    if (!ran) return marked
    return finishTranscription(snapId, commentId, marked, lang)
  }

  // Try again, from anyone who can see the snap. Refused with a conflict while a genuine
  // transcription is still live; recovers one the platform killed mid-run.
  async function retranscribeReaction(m: M, snapId: string, commentId: string, language?: unknown): Promise<Snap<M>> {
    const lang = spokenLanguage(language, transcriber().languages)
    const marked = await rewrite(snapId, (s) => {
      if (!canSeeSnap(s, m)) throw new RuleError('snap not found', 404)
      const c = (s.comments ?? []).find((x) => x.id === commentId)
      if (!c?.recording) throw new RuleError('reaction not found', 404)
      if (!canRetranscribe(c.recording, c.at, nowIso())) throw new RuleError('this reaction is still being transcribed', 409)
      return markTranscribing(s, commentId, lang === 'auto' ? undefined : lang, { now: nowIso() }) as Snap<M>
    })
    return finishTranscription(snapId, commentId, marked, lang)
  }

  const promptsOn = () => {
    if (!features.prompts || !host.prompts) throw new RuleError('reminders are not on here', 404)
    return host.prompts
  }
  const report = (what: string, err: unknown) => { try { host.log?.(what, err) } catch { /* a log that throws is dropped too */ } }

  // Each reminder is claimed with create() BEFORE it is sent, so two overlapping runs, a late run
  // and a repeated run can never send the same slot on the same day twice (the claim's id is the
  // slot's key). A nudge that fails keeps its claim: a reminder sent twice is worse than one missed.
  async function sendDuePrompts(now: Date): Promise<string[]> {
    const p = promptsOn()
    const today = zoned(now, p.timeZone).dayKey
    const claims = host.db().collection(p.collection)
    const sent = new Set((await claims.where('dayKey', '==', today).get()).docs.map((d) => d.id))
    const done: string[] = []
    for (const due of promptsDue(now, p.timeZone, await p.people(), sent)) {
      try { await claims.doc(due.slotKey).create({ dayKey: today, person: due.key, sentAt: now.toISOString() }) } catch { continue }
      try { await p.nudge(due.key, due.slotKey) } catch (err) { report('prompts.nudge failed', err) }
      done.push(due.slotKey)
    }
    return done
  }

  async function promptPerson(m: M) {
    const p = promptsOn()
    const me = (await p.people()).find((x) => x.key === m)
    if (!me) throw new RuleError('you have no reminders here', 403)
    return { p, me }
  }

  async function promptSettings(m: M): Promise<PromptSettings & { today: string }> {
    const { p, me } = await promptPerson(m)
    return { times: me.times, snoozedUntil: me.snoozedUntil, today: zoned(new Date(), p.timeZone).dayKey }
  }

  async function savePromptSettings(m: M, body: unknown): Promise<PromptSettings> {
    const { p, me } = await promptPerson(m)
    const next = parsePromptPatch(body, { times: me.times, snoozedUntil: me.snoozedUntil }, zoned(new Date(), p.timeZone).dayKey)
    await p.save(m, next)
    return next
  }

  return {
    features,
    finalizeSnapPhoto, finalizeSnapVideo, readSnaps, listSnaps, listCowitness, listWitnessed, getSnapView, patchSnap,
    listQueue, cowitnessSummary, reactionUploadUrl, attachReaction, reactionAudioUrl, transcribeReaction, retranscribeReaction,
    sendDuePrompts, promptSettings, savePromptSettings,
  }
}

export type CowitnessStore<M extends string> = ReturnType<typeof createCowitnessStore<M>>
