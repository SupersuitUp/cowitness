'use client'

import { useEffect, useRef, useState } from 'react'
import { AUDIO_BITS_PER_SECOND, MIC_CONSTRAINTS, RECORD_MAX_SEC, formatClock, pickMimeType } from './recorder.js'
import { beginRecording, endRecording, indexedDbVault, keepChunk, memoryVault, newRecordingId } from './recording-vault.js'
import { voiceSnapKey } from './voice-snap.js'
import { ACCENT, HAIRLINE, INK, MUTED, ON_INK, SERIF } from './theme.js'

// One big button: tap to record, tap to stop. Every second of sound goes into the phone's own vault
// as it is made, under the id it will be filed with, so a dropped connection or a closed app never
// loses it. The vault key says what it is: a voice snap by default, a reaction when the app says so.
// Cancel is drawn only for a caller that gives it somewhere to go.
export function VoiceNote({ onRecorded, onCancel, vaultKey = voiceSnapKey }: {
  onRecorded(rec: { blob: Blob; durationSec: number; id: string }): void; onCancel?(): void; vaultKey?: (id: string) => string
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'failed'>('idle')
  const [sec, setSec] = useState(0)
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; id: string; started: number; chunks: Blob[] } | null>(null)
  const vault = useRef(indexedDbVault() ?? memoryVault())

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => {
      const now = rec.current ? (Date.now() - rec.current.started) / 1000 : 0
      setSec(now)
      if (now >= RECORD_MAX_SEC) stop()
    }, 250)
    return () => clearInterval(t)
  }, [state])
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()) }, [])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
      const id = newRecordingId()
      const started = Date.now()
      const chunks: Blob[] = []
      await beginRecording(vault.current, { id, noteId: vaultKey(id), mimeType: r.mimeType || mimeType })
      r.ondataavailable = (e) => { chunks.push(e.data); void keepChunk(vault.current, id, e.data, (Date.now() - started) / 1000) }
      r.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - started) / 1000))
        stream.getTracks().forEach((t) => t.stop())
        void endRecording(vault.current, id, durationSec)
        onRecorded({ blob: new Blob(chunks, { type: r.mimeType || mimeType }), durationSec, id })
      }
      rec.current = { r, stream, id, started, chunks }
      r.start(1000)
      setState('recording')
    } catch {
      setState('failed')
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
        <button type="button" onClick={onCancel} className="h-11 px-3 text-sm" style={{ color: MUTED, borderBottom: `1px solid ${HAIRLINE}` }}>Cancel</button>
      )}
    </div>
  )
}
