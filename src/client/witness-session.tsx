'use client'
import { clientConfig } from './config.js'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Member, MemberNames } from '../types.js'
import type { SnapView } from '../types.js'
import { MESSAGE_MAX } from '../shared-rules.js'
import { REACTION_MAX_SEC } from '../snap-rules.js'
import { useHistoryLayer } from './history-layer.js'
import { formatWhen } from './format-when.js'
import { advance, begin, isDone, isSwipeUp, progressLabel, sendsRecording, witnessPatch } from './witness-flow.js'
import { noPosterBg } from './video-mark.js'
import { AUDIO_BITS_PER_SECOND, atCap, formatClock, nearCap, pickMimeType } from './recorder.js'
import { meterWidth } from './hearing.js'
import { SPEECH_FLOOR_SEC, shouldKeep, startTally, tally, type SpeechTally } from './speech.js'
import { analyserListener, type Listener } from './mic-level.js'
import { reactionKey, sendHeld, sendReaction } from './reaction-send.js'
import {
  beginRecording, endRecording, forget, indexedDbVault, keepChunk, memoryVault, newRecordingId, type VaultStore,
} from './recording-vault.js'
import { ACCENT, ACCENT_SOFT, SERIF } from './theme.js'

interface Props {
  queue: SnapView[]; me: Member; names: MemberNames; onClose(): void
  /** The session's one microphone, asked for in the Witness tap. Absent: typing only. */
  mic?: Promise<MediaStream> | null
  /** How the level is read off the stream; the analyser by default, a fake in tests. */
  listen?(stream: MediaStream): Listener | null
}

type Mic = 'none' | 'waiting' | 'on' | 'off'
interface Take { rec: MediaRecorder; snapId: string; held: string; type: string; startedAt: number; chunks: Blob[] }
interface Finished { blob: Blob; durationSec: number; held: string; snapId: string; keep: boolean }

// How long "You're all caught up" stays up before the session closes itself.
const CAUGHT_UP_MS = 2000
// How often the level is read for the meter, the clock and the speech tally.
const POLL_MS = 100
// A recorder that neither stops nor errors (a browser bug, a suspended page) must not hold Next.
const STOP_GIVE_UP_MS = 3000

// A witness session: each waiting snap in turn, oldest first, full screen. Next (or a swipe up)
// saves whatever was said, marks the snap witnessed, and shows the next. Stopping halfway is
// fine: every Next was its own save, and the rest waits in the queue. It is a history layer, so
// the phone's back gesture ends it.
//
// With a microphone, each snap gets its own recording on the session's one stream, kept on the
// phone chunk by chunk as it is made. Next sends it in the background when something was said
// and lets it go when nothing was; the witness itself never waits on the upload.
export function WitnessSession({ queue, names, onClose, mic, listen }: Props) {
  // The queue as it was when the session opened. A router.refresh() underneath would drop the
  // snaps just witnessed and shift every index, so the session walks its own copy.
  const [items] = useState(() => queue)
  const [session, setSession] = useState(() => begin(items.length))
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [micState, setMicState] = useState<Mic>(mic ? 'waiting' : 'none')
  const [mode, setMode] = useState<'voice' | 'typing'>('voice')
  const [clock, setClock] = useState({ sec: 0, level: 0, live: false, capped: false })
  const [sending, setSending] = useState(0)
  const touchY = useRef<number | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const listener = useRef<Listener | null>(null)
  const vault = useRef<VaultStore>(memoryVault())
  const take = useRef<Take | null>(null)
  const speech = useRef<SpeechTally>(startTally())
  // This snap's recording once it has been cut early (Type instead, or the three minute stop),
  // waiting for Next to send it or let it go.
  const pending = useRef<Promise<Finished | null> | null>(null)
  // Every way out saves the snap on screen first (see saveOnLeave). The back gesture arrives
  // here rather than through leave(), and it must cut the recording before CowitnessHome lets go
  // of the microphone in onClose.
  const saveOnLeaveRef = useRef<() => void>(() => {})
  const dismiss = useHistoryLayer('witness', true, () => { saveOnLeaveRef.current(); onClose() })
  const done = isDone(session)
  const snap = done ? null : items[session.index]
  const last = session.index === session.total - 1
  const listening = micState === 'on' && mode === 'voice' && !clock.capped

  // Every way out goes through here exactly once: the ×, Close, and the self-close after the
  // last snap. A second history.back() would leave the Cowitness page, not the session.
  const left = useRef(false)
  const autoClose = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leave = () => {
    if (autoClose.current !== null) { clearTimeout(autoClose.current); autoClose.current = null }
    if (left.current) return
    left.current = true
    saveOnLeaveRef.current()
    dismiss()
  }
  const leaveRef = useRef(leave)
  leaveRef.current = leave

  useEffect(() => {
    if (!done) return
    autoClose.current = setTimeout(() => { autoClose.current = null; leaveRef.current() }, CAUGHT_UP_MS)
    return () => { if (autoClose.current !== null) { clearTimeout(autoClose.current); autoClose.current = null } }
  }, [done])

  // The words in the box, readable when the microphone arrives after the reader has started typing.
  const typedNow = useRef('')
  typedNow.current = typed

  // Granted but unusable here (no MediaRecorder, no audio format it can make): let go of the
  // microphone at once, so the phone does not show it in use for a session that cannot record.
  const micOff = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setMicState('off')
  }, [])

  // The phone's own store, and anything an earlier session left on it.
  useEffect(() => {
    vault.current = indexedDbVault() ?? memoryVault()
    void sendHeld(vault.current).catch(() => {})
  }, [])

  // The one stream for the whole session.
  useEffect(() => {
    if (!mic) return
    let live = true
    mic.then((s) => {
      if (!live) return
      stream.current = s
      if (typeof MediaRecorder === 'undefined') { micOff(); return }
      listener.current = (listen ?? analyserListener)(s)
      // The reader was already typing while the phone asked: keep their words, and the mic stays paused
      // for this snap. The next one listens.
      if (typedNow.current.trim()) setMode('typing')
      setMicState('on')
    }).catch(() => { if (live) setMicState('off') })
    return () => {
      live = false
      // What was recorded for the snap on screen is saved or let go of by saveOnLeave.
      // The stream and the AudioContext belong to CowitnessHome, which asked for them and
      // releases them when the session ends. Stopping them here would also fire on React's
      // development double-mount and leave the session with a dead microphone.
    }
    // `listen` is read once, when the stream arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic])

  // Cut this snap's recording. Resolves once the recorder has handed over its last chunk, and
  // never later than that: a recorder already stopped (Next before it started, or the phone
  // ended it on its own), one that errors, or one that never answers all resolve too, because
  // Next waits on this and Next must never hang.
  const cut = useCallback((): Promise<Finished | null> => {
    const t = take.current
    if (!t) return Promise.resolve(null)
    take.current = null
    const heard = speech.current
    return new Promise((resolve) => {
      let settled = false
      let giveUp: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (settled) return
        settled = true
        if (giveUp !== null) clearTimeout(giveUp)
        t.rec.ondataavailable = null; t.rec.onstop = null; t.rec.onerror = null
        const elapsedMs = Date.now() - t.startedAt
        const durationSec = Math.max(1, Math.round(elapsedMs / 1000))
        // Not awaited: the vault applies this before any later forget of the same recording,
        // and a store that is slow (or stuck) must never be what holds Next.
        void endRecording(vault.current, t.held, durationSec).catch(() => {})
        const keep = worthKeeping(elapsedMs, heard)
        resolve({ blob: new Blob(t.chunks, { type: t.type }), durationSec, held: t.held, snapId: t.snapId, keep })
      }
      if (t.rec.state === 'inactive') { finish(); return }
      t.rec.onstop = finish
      t.rec.onerror = finish
      giveUp = setTimeout(finish, STOP_GIVE_UP_MS)
      try { t.rec.stop() } catch { finish() }
    })
  }, [])

  const record = useCallback(async (snapId: string) => {
    const s = stream.current
    if (!s || take.current) return
    const mimeType = pickMimeType((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
    if (!mimeType) { micOff(); return }
    let rec: MediaRecorder
    try { rec = new MediaRecorder(s, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }) } catch { micOff(); return }
    const t: Take = { rec, snapId, held: newRecordingId(), type: mimeType.split(';')[0], startedAt: Date.now(), chunks: [] }
    take.current = t
    speech.current = startTally()
    pending.current = null
    setClock({ sec: 0, level: 0, live: true, capped: false })
    // The vault is opened BEFORE the first chunk, so nothing said is ever only in memory.
    await beginRecording(vault.current, { id: t.held, noteId: reactionKey(snapId), mimeType: t.type }).catch(() => {})
    // Cut while the store was opening (Next, Type instead, leaving): nobody owns this any more.
    if (take.current !== t) { void forget(vault.current, t.held); return }
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return
      t.chunks.push(e.data)
      void keepChunk(vault.current, t.held, e.data, (Date.now() - t.startedAt) / 1000).catch(() => {})
    }
    try { rec.start(1000) } catch { take.current = null; void forget(vault.current, t.held); micOff() }
  }, [micOff])

  // A fresh recording whenever a snap appears and the mic is listening.
  useEffect(() => {
    if (snap && micState === 'on' && mode === 'voice') void record(snap.id)
  }, [snap, micState, mode, record])

  // The level, the clock, the speech tally and the cap, ten times a second while recording.
  useEffect(() => {
    if (!clock.live) return
    const timer = setInterval(() => {
      const t = take.current
      if (!t) return
      const now = Date.now()
      const level = listener.current?.level() ?? 0
      speech.current = tally(speech.current, level, now)
      const sec = Math.floor((now - t.startedAt) / 1000)
      if (atCap(sec, REACTION_MAX_SEC)) {
        setClock({ sec, level: 0, live: false, capped: true })
        pending.current = cut()
        return
      }
      setClock((c) => ({ ...c, sec, level }))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [clock.live, cut])

  // Kept: sent in the background, and let go of only once the server has it. Anything that
  // fails stays on the phone, and sendHeld sends it on the next visit under the same id.
  const release = (f: Finished | null, typed: string) => {
    if (!f) return
    if (!sendsRecording(f.keep, typed) || f.blob.size === 0) { void forget(vault.current, f.held); return }
    setSending((n) => n + 1)
    void sendReaction(f.snapId, f.blob, f.durationSec, f.held)
      .then(() => forget(vault.current, f.held))
      .catch(() => { /* Still in the vault; sendHeld sends it next time. */ })
      .finally(() => setSending((n) => n - 1))
  }

  const typeInstead = () => {
    pending.current = cut()
    setClock((c) => ({ ...c, live: false }))
    setMode('typing')
  }

  const witness = (snapId: string, words: string) => fetch(`${clientConfig().apiBase}/${snapId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(witnessPatch(words)),
  }).catch(() => null)

  // The snap on screen and whether Next is already saving it, for the ways out that run outside
  // a render (the back gesture, the page going away).
  const snapNow = useRef<SnapView | null>(snap)
  snapNow.current = snap
  const nexting = useRef(false)
  const savedOnLeave = useRef(false)

  // Ending the session mid-snap. Anything said or typed for the snap on screen is saved exactly
  // as Next saves it: the recording sent under its vault id, the snap witnessed with their words.
  // A snap left in silence with nothing typed stays waiting, and its empty recording is let go
  // of. Runs once, from the ×, the back gesture or the page going away, whichever comes first,
  // and never holds the way out: cut() cannot hang, and the rest finishes in the background.
  const saveOnLeave = () => {
    const s = snapNow.current
    if (!s || savedOnLeave.current || nexting.current) return
    const words = typedNow.current
    const t = take.current
    const p = pending.current
    const said = t !== null && worthKeeping(Date.now() - t.startedAt, speech.current)
    if (!p && !said && !words.trim()) {
      take.current = null
      if (t) {
        t.rec.ondataavailable = null; t.rec.onstop = null; t.rec.onerror = null
        if (t.rec.state !== 'inactive') t.rec.stop()
        void forget(vault.current, t.held)
      }
      return
    }
    savedOnLeave.current = true
    pending.current = null
    const f = p ?? cut()
    void f.then((finished) => { release(finished, words); return witness(s.id, words) })
  }
  saveOnLeaveRef.current = saveOnLeave
  useEffect(() => () => saveOnLeaveRef.current(), [])

  const next = async () => {
    if (!snap || saving) return
    setSaving(true)
    setFailed(false)
    nexting.current = true
    const f = await (pending.current ?? cut())
    pending.current = null
    setClock((c) => ({ ...c, live: false }))
    release(f, typed)
    const res = await witness(snap.id, typed)
    nexting.current = false
    setSaving(false)
    // 404: the member who posted it hid it mid-session. It is gone, not unsaved, so move on.
    if (!res?.ok && res?.status !== 404) {
      setFailed(true)
      // Still on this snap: listen again, since what was said so far is already on its way.
      if (micState === 'on' && mode === 'voice') void record(snap.id)
      return
    }
    setTyped('')
    setMode('voice')
    setClock({ sec: 0, level: 0, live: false, capped: false })
    setSession(advance)
  }

  // Only a listening mic hides the box. While the phone is still asking for the microphone the
  // reader can already type, so there is never a snap with nothing to do but Next.
  const showBox = micState !== 'on' || mode === 'typing' || clock.capped

  return (
    <div role="dialog" aria-modal="true" aria-label="Witness" className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+8px)]">
        <span className="text-sm opacity-80">{done ? '' : progressLabel(session)}</span>
        <button type="button" onClick={leave} aria-label="End session" className="-mr-2 flex h-11 w-11 items-center justify-center text-2xl">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
          <p className="text-center text-2xl" style={{ fontFamily: SERIF }}>You&apos;re all caught up</p>
          {sending > 0 && <p className="text-sm text-white/70">Still sending {sending === 1 ? 'one reaction' : `${sending} reactions`}.</p>}
          <button type="button" onClick={leave} className="h-12 rounded-full bg-white px-8 text-[17px] font-medium text-black">Close</button>
        </div>
      ) : snap && (
        <>
          <div
            data-testid="witness-stage"
            className="flex min-h-0 flex-1 items-center justify-center"
            onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null }}
            onTouchEnd={(e) => {
              const start = touchY.current
              touchY.current = null
              const end = e.changedTouches[0]?.clientY
              if (start !== null && end !== undefined && isSwipeUp(start, end)) void next()
            }}
          >
            {snap.kind === 'video'
              ? <WitnessVideo key={snap.id} snap={snap} label={`Snap from ${names[snap.by]}`} />
              // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL
              : <img key={snap.id} src={snap.displayUrl ?? undefined} alt={`Snap from ${names[snap.by]}`} className="max-h-full max-w-full object-contain" />}
          </div>
          <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
            {snap.caption && <p className="mb-1 whitespace-pre-wrap text-[17px] leading-snug" style={{ fontFamily: SERIF }}>{snap.caption}</p>}
            <SnapTime at={snap.takenAt} />

            {listening && (
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full motion-reduce:animate-none" style={{ backgroundColor: ACCENT }} aria-hidden="true" />
                <span className="text-sm">Listening</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
                  <span className="block h-full rounded-full bg-white/70" style={{ width: `${meterWidth(clock.level)}%` }} />
                </span>
                <span className="text-xs tabular-nums text-white/70">
                  {formatClock(clock.sec)}{nearCap(clock.sec, REACTION_MAX_SEC) ? ` · stops at ${formatClock(REACTION_MAX_SEC)}` : ''}
                </span>
              </div>
            )}
            {clock.capped && <p className="mt-3 text-sm text-white/80">That is three minutes, the most for one snap. Tap {last ? 'Done' : 'Next'} when you are ready.</p>}
            {micState === 'off' && <p className="mt-3 text-sm text-white/70">The microphone is off. You can type.</p>}
            {micState === 'on' && mode === 'typing' && <p className="mt-3 text-sm text-white/70">The mic is paused while you type.</p>}

            {showBox && (
              <>
                <label htmlFor="witness-typed" className="sr-only">Say something back</label>
                <textarea
                  id="witness-typed" value={typed} maxLength={MESSAGE_MAX} rows={2}
                  onChange={(e) => { setTyped(e.target.value); setFailed(false) }}
                  placeholder="Say something back, or just tap Next"
                  className="mt-3 w-full resize-none rounded-2xl bg-white/10 px-4 py-3 text-[17px] leading-relaxed text-white outline-none placeholder:text-white/50"
                />
              </>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              {listening && <button type="button" onClick={typeInstead} className="h-12 rounded-full border border-white/40 px-5 text-sm">Type instead</button>}
              <span aria-live="polite" className="text-sm" style={{ color: ACCENT_SOFT }}>{failed ? 'Not saved. Try again.' : ''}</span>
              <button type="button" onClick={() => { void next() }} disabled={saving} className="h-12 rounded-full bg-white px-8 text-[17px] font-medium text-black disabled:opacity-50">
                {last ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Under a second of recording cannot hold a second of speech, measured or not.
const worthKeeping = (elapsedMs: number, heard: SpeechTally) =>
  elapsedMs >= SPEECH_FLOOR_SEC * 1000 && shouldKeep(heard)

// Plays once, inline, with sound. The tap that opened the session (or the Next that led here)
// is the gesture a phone wants before it plays sound; if it still refuses, a tap plays it.
function WitnessVideo({ snap, label }: { snap: SnapView; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = false
    void Promise.resolve(el.play()).catch(() => setBlocked(true))
    return () => { el.pause() }
  }, [])
  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      <video
        ref={ref} src={snap.videoUrl} poster={snap.posterUrl ?? undefined} aria-label={label}
        playsInline preload="auto" className="max-h-full max-w-full"
        style={{ backgroundColor: snap.posterUrl ? undefined : noPosterBg() }}
      />
      {blocked && (
        <button type="button" onClick={() => { setBlocked(false); void ref.current?.play() }} className="absolute inset-0 flex items-center justify-center text-lg">
          Tap to play
        </button>
      )}
    </div>
  )
}

// When the snap was taken. Formatted after mount, in the phone's own time zone.
function SnapTime({ at }: { at: string }) {
  const [label, setLabel] = useState('')
  useEffect(() => { setLabel(formatWhen(at)) }, [at])
  return <time dateTime={at} className="text-xs text-white/60">{label}</time>
}
