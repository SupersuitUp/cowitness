'use client'
import { clientConfig } from './config.js'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Member, MemberNames } from '../types.js'
import type { SnapView } from '../types.js'
import type { SnapRow } from '../format.js'
import { AddSnap } from './add-snap.js'
import { StreakStrip } from './streak-strip.js'
import { SnapsArchive } from './snaps-archive.js'
import { WitnessSession } from './witness-session.js'
import { SESSION_MIC_CONSTRAINTS } from './recorder.js'
import { analyserListener, newAudioContext } from './mic-level.js'
import { sendHeld } from './reaction-send.js'
import { indexedDbVault, memoryVault } from './recording-vault.js'
import { ACCENT, MUTED, ON_INK, SERIF } from './theme.js'

// Inside Cowitness: Witness (N) at the top when anything is waiting, then Add a snap, then what
// is still open. Witnessed snaps live on their own shelf, one link away. The session opens over this page as a history layer, and the tap on Witness is the
// user gesture it starts from: the microphone is asked for inside `witness`, in that same tap,
// because a phone only grants it there.
export function CowitnessHome({ rows, streak, witnessed, queue, me, names }: {
  rows: SnapRow[]; streak: SnapRow[]; witnessed: number; queue: SnapView[]; me: Member; names: MemberNames
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mic, setMic] = useState<{ stream: Promise<MediaStream>; ctx: AudioContext | null } | null>(null)

  // A reaction an earlier visit could not send (a dropped connection, the app closed mid-send)
  // goes as soon as the reader is back here, not only when there is something new to witness. Once per
  // visit, in the background, and quietly: anything that fails stays held for the next one.
  const sentHeld = useRef(false)
  useEffect(() => {
    if (sentHeld.current) return
    sentHeld.current = true
    void sendHeld(indexedDbVault() ?? memoryVault()).catch(() => {})
  }, [])

  // Everything that needs the user's gesture happens inside this tap: the microphone permission
  // (asked once for the whole session) and the AudioContext the level is read with.
  const witness = () => {
    const stream = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ audio: SESSION_MIC_CONSTRAINTS })
      : Promise.reject(new Error('no microphone'))
    stream.catch(() => {})
    setMic({ stream, ctx: newAudioContext() })
    setOpen(true)
  }

  // Release the microphone and the AudioContext this page asked for.
  const release = (m: typeof mic) => {
    void m?.stream.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {})
    void m?.ctx?.close().catch(() => {})
  }
  // Leaving the page mid-session (a link, a tab in the nav) never ends the session through
  // onClose, so the page's own unmount lets go of the microphone too.
  const current = useRef(mic)
  current.current = mic
  useEffect(() => () => release(current.current), [])

  // The session is over.
  const endSession = () => {
    release(mic)
    setOpen(false)
    setMic(null)
    router.refresh()
  }
  return (
    <>
      <div className="mb-4"><StreakStrip rows={streak} me={me} names={names} /></div>
      <div className="px-4">
        {queue.length > 0 ? (
          <button
            type="button"
            onClick={witness}
            className="flex h-16 w-full items-center justify-center rounded-2xl text-xl transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none"
            style={{ backgroundColor: ACCENT, color: ON_INK, fontFamily: SERIF, fontWeight: 500 }}
          >
            Witness ({queue.length})
          </button>
        ) : (
          <p className="py-2 text-center text-[15px]" style={{ color: MUTED, fontFamily: SERIF }}>Nothing waiting for you.</p>
        )}
      </div>
      <div className="mt-4"><AddSnap /></div>
      <div className="mt-6">
        <SnapsArchive rows={rows} me={me} names={names} empty={witnessed > 0 ? 'All caught up.' : undefined} />
      </div>
      {witnessed > 0 && (
        <p className="text-center">
          <Link href={`${clientConfig().pageBase}/witnessed`} className="inline-flex h-11 items-center px-3 text-sm" style={{ color: MUTED }}>Witnessed ({witnessed}) ›</Link>
        </p>
      )}
      {open && (
        <WitnessSession
          queue={queue} me={me} names={names}
          mic={mic?.stream ?? null}
          listen={(s) => analyserListener(s, mic?.ctx ?? null)}
          onClose={endSession}
        />
      )}
    </>
  )
}
