'use client'

import { useEffect, useRef, useState } from 'react'
import { AUDIO_BITS_PER_SECOND, MIC_CONSTRAINTS, RECORD_MAX_SEC, formatClock, pickMimeType } from './recorder.js'
import { beginRecording, endRecording, forget, indexedDbVault, keepChunk, memoryVault, newRecordingId } from './recording-vault.js'
import { voiceSnapKey } from './voice-snap.js'
import { ACCENT, HAIRLINE, INK, MUTED, ON_INK, SERIF } from './theme.js'

// One big button: tap to record, tap to stop. Every second of sound goes into the phone's own vault
// as it is made, under the id it will be filed with, so a dropped connection or a closed app never
// loses it. The vault key says what it is: a voice snap by default, a reaction when the app says so.
// Cancel is drawn only for a caller that gives it somewhere to go.
//
// A recording the person walks away from (Cancel, or the sheet closing) is gone: the microphone is
// turned off, nothing is handed back and nothing stays held, even though a recorder whose tracks end
// still reports its stop. The microphone is turned off on every path that opened it, including a
// permission prompt that answers after the sheet has gone.
export function VoiceNote({ onRecorded, onCancel, vaultKey = voiceSnapKey }: {
  onRecorded(rec: { blob: Blob; durationSec: number; id: string }): void; onCancel?(): void; vaultKey?: (id: string) => string
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'failed'>('idle')
  const [sec, setSec] = useState(0)
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; id: string; started: number; chunks: Blob[] } | null>(null)
  const vault = useRef(indexedDbVault() ?? memoryVault())
  const mounted = useRef(true)

  // Walk away from whatever is being recorded: no handler left to hand it back, the microphone off,
  // the held copy forgotten.
  const discard = () => {
    const cur = rec.current
    rec.current = null
    if (!cur) return
    cur.r.ondataavailable = null
    cur.r.onstop = null
    try { if (cur.r.state === 'recording') cur.r.stop() } catch { /* already stopped */ }
    cur.stream.getTracks().forEach((t) => t.stop())
    void forget(vault.current, cur.id)
  }

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => {
      const now = rec.current ? (Date.now() - rec.current.started) / 1000 : 0
      setSec(now)
      if (now >= RECORD_MAX_SEC) stop()
    }, 250)
    return () => clearInterval(t)
  }, [state])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; discard() }
  }, [])

  const start = async () => {
    let stream: MediaStream | null = null
    let id: string | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      if (!mounted.current) { stream.getTracks().forEach((t) => t.stop()); return }
      const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
      id = newRecordingId()
      const started = Date.now()
      const chunks: Blob[] = []
      await beginRecording(vault.current, { id, noteId: vaultKey(id), mimeType: r.mimeType || mimeType })
      if (!mounted.current) { stream.getTracks().forEach((t) => t.stop()); void forget(vault.current, id); return }
      const opened = stream
      r.ondataavailable = (e) => { chunks.push(e.data); void keepChunk(vault.current, id!, e.data, (Date.now() - started) / 1000) }
      r.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - started) / 1000))
        opened.getTracks().forEach((t) => t.stop())
        rec.current = null
        void endRecording(vault.current, id!, durationSec)
        onRecorded({ blob: new Blob(chunks, { type: r.mimeType || mimeType }), durationSec, id: id! })
      }
      rec.current = { r, stream, id, started, chunks }
      r.start(1000)
      setState('recording')
    } catch {
      stream?.getTracks().forEach((t) => t.stop())
      if (id) void forget(vault.current, id).catch(() => {})
      if (mounted.current) setState('failed')
    }
  }
  const stop = () => { if (rec.current?.r.state === 'recording') rec.current.r.stop(); setState('idle') }

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <button
        type="button" onClick={state === 'recording' ? stop : start}
        className="flex h-20 w-20 items-center justify-center rounded-full text-sm font-medium"
        style={{ backgroundColor: state === 'recording' ? ACCENT : INK, color: ON_INK }}
      >
        {state === 'recording' ? 'Stop' : 'Record'}
      </button>
      <p aria-live="polite" className="text-sm" style={{ color: state === 'failed' ? ACCENT : MUTED, fontFamily: SERIF }}>
        {state === 'failed' ? 'The microphone did not open. Check the permission and try again.' : state === 'recording' ? formatClock(sec) : 'Tap to record a voice note'}
      </p>
      {onCancel && (
        <button type="button" onClick={() => { discard(); onCancel() }} className="h-11 px-3 text-sm" style={{ color: MUTED, borderBottom: `1px solid ${HAIRLINE}` }}>Cancel</button>
      )}
    </div>
  )
}
