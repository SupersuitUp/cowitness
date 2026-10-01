'use client'
import { clientConfig } from './config.js'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Member, MemberNames } from '../types.js'
import type { Comment, Recording, SnapView } from '../types.js'
import { formatWhen } from './format-when.js'
import { noPosterBg } from './video-mark.js'
import { HAIRLINE, INK, MUTED, SERIF } from './theme.js'
import { otherIn } from './people.js'

// The optimistic transcribing recording carries none of a previous attempt's leftovers: an old
// reason would be meaningless once it is transcribing again, and an old startedAt would make it
// look stale the instant it starts, showing Try again right beside "Transcribing".
function startTranscribing(rec: Recording, now: string): Recording {
  const { reason: _reason, startedAt: _startedAt, ...rest } = rec
  return { ...rest, status: 'transcribing', startedAt: now }
}

// One snap: the photo or video, its caption, who shared it and when, and every message under
// it. The member who shared it can hide it (and bring it back); nobody can delete it.
export function SnapDetail({ snap, me, names }: { snap: SnapView; me: Member; names: MemberNames }) {
  const router = useRouter()
  const [comments, setComments] = useState<Comment[] | undefined>(snap.comments)
  const [retryNote, setRetryNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = snap.by === me
  const hidden = snap.hiddenAt !== null
  const [when, setWhen] = useState('')
  useEffect(() => { setWhen(formatWhen(snap.createdAt)) }, [snap.createdAt])

  const POLL_MS = 4000
  const POLL_MAX_MS = 5 * 60 * 1000
  const transcribing = (comments ?? []).some((c) => c.recording?.status === 'transcribing')

  // Bumped by every local, decisive change to `comments` (a send, a heart, a Try again). A poll
  // in flight when one of those lands is carrying an older snapshot of the conversation; it
  // records this counter when it starts and drops its answer if the count has moved by the time
  // it comes back, so a just-sent message or a just-started retry can never be overwritten by a
  // slower request that started before it. `commit` always applies to the LATEST state, not a
  // snapshot closed over at call time: a retranscribe that takes a while must not clobber a
  // message sent while it was still in flight, whichever of the two answers back last.
  const seq = useRef(0)
  const commit = useCallback((updater: (cs: Comment[] | undefined) => Comment[] | undefined) => {
    seq.current += 1
    setComments(updater)
  }, [])

  // Words are written in a little after a reaction is filed; check back while any are pending,
  // and give up after five minutes (the thread still offers Try again on a reaction stuck that
  // long). Stops on its own the moment nothing is transcribing anymore, and on unmount, because
  // the cleanup below runs whenever `transcribing` flips or the page goes away. Chains each
  // check off the end of the last one (rather than a fixed-rate interval) so a slow request can
  // never overlap with the next tick, and a bad response (a network drop, a malformed body) is
  // caught so the chain keeps going instead of dying silently.
  useEffect(() => {
    if (!transcribing) return
    const started = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (cancelled || Date.now() - started > POLL_MAX_MS) return
      const mySeq = seq.current
      try {
        const res = await fetch(`${clientConfig().apiBase}/${snap.id}`)
        if (res.ok) {
          const data = (await res.json()) as SnapView
          if (!cancelled && seq.current === mySeq) setComments(data.comments)
        }
      } catch {
        // Try again on the next tick rather than giving up on the whole check-back.
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }
    timer = setTimeout(tick, POLL_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [transcribing, snap.id])

  // The quiet note is only ever about a reaction that is still transcribing; once none is, it
  // has nothing left to say.
  useEffect(() => { if (!transcribing) setRetryNote(null) }, [transcribing])

  const retranscribe = useCallback(async (commentId: string) => {
    setRetryNote(null)
    const now = new Date().toISOString()
    commit((cs) => (cs ?? []).map((c) => (c.id === commentId && c.recording
      ? { ...c, recording: startTranscribing(c.recording, now) }
      : c)))
    const res = await fetch(`${clientConfig().apiBase}/${snap.id}/reactions/${commentId}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (res?.ok) {
      const data = (await res.json()) as SnapView
      commit(() => data.comments)
      return
    }
    if (res?.status === 409) {
      // Already transcribing, and not stale: nothing actually went wrong. Say so quietly rather
      // than reporting a failure the recording did not have.
      setRetryNote('Still working on it.')
      return
    }
    commit((cs) => (cs ?? []).map((c) => (c.id === commentId && c.recording
      ? { ...c, recording: { ...c.recording, status: 'failed' as const, reason: 'the request did not reach the server' } }
      : c)))
  }, [snap.id, commit])

  const setHidden = async (value: boolean) => {
    setBusy(true)
    const res = await fetch(`${clientConfig().apiBase}/${snap.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: value ? 'hide' : 'unhide' }),
    }).catch(() => null)
    setBusy(false)
    if (!res?.ok) return
    if (value) router.push(clientConfig().pageBase); else router.refresh()
  }

  return (
    <div className="px-4">
      <div className="overflow-hidden rounded-2xl" style={{ backgroundColor: HAIRLINE }}>
        {snap.kind === 'video'
          ? <SnapVideo snap={snap} label={`Snap from ${names[snap.by]}`} />
          // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL
          : <img src={snap.displayUrl ?? undefined} alt={`Snap from ${names[snap.by]}`} className="max-h-[70dvh] w-full object-contain" />}
      </div>
      {snap.caption && <p className="mt-3 whitespace-pre-wrap text-[17px] leading-relaxed" style={{ color: INK, fontFamily: SERIF }}>{snap.caption}</p>}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs" style={{ color: MUTED }}>
          {mine ? 'You' : names[snap.by]}{when ? ` · ${when}` : ''}
          {mine && snap.witnessedAt ? ` · Witnessed by ${names[otherIn(names, me)]}` : ''}
        </p>
        {mine && (
          <button type="button" disabled={busy} onClick={() => setHidden(!hidden)} className="h-11 px-2 text-sm underline underline-offset-2 disabled:opacity-40" style={{ color: MUTED }}>
            {hidden ? 'Bring back' : 'Hide'}
          </button>
        )}
      </div>
      {retryNote && <p aria-live="polite" className="mt-2 text-xs" style={{ color: MUTED }}>{retryNote}</p>}
      {/* The conversation is the app's own, so it looks like every other conversation in it. */}
      {!hidden && clientConfig().renderThread({
        snapId: snap.id, me, names, comments, onSent: (next) => commit(() => next),
        audioSrc: (c) => (c.recording ? `${clientConfig().apiBase}/${snap.id}/reactions/${c.id}/audio` : null),
        onRetranscribe: (id) => { void retranscribe(id) },
      })}
    </div>
  )
}

function SnapVideo({ snap, label }: { snap: SnapView; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  // Leaving the page must not leave the sound playing.
  useEffect(() => { const el = ref.current; return () => { el?.pause() } }, [])
  return (
    <video
      ref={ref} src={snap.videoUrl} poster={snap.posterUrl ?? undefined} aria-label={label}
      playsInline controls preload="metadata" className="max-h-[70dvh] w-full"
      style={{ backgroundColor: snap.posterUrl ? undefined : noPosterBg() }}
    />
  )
}
