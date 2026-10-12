'use client'

import { useEffect, useState } from 'react'
import type { SnapView } from '../types.js'
import { mayRetranscribeVoice } from '../voice-rules.js'
import { clientConfig } from './config.js'
import { INK, MUTED, SERIF } from './theme.js'
import { CompactAudio } from './compact-audio.js'

// A voice snap: the recording, and its words under it once they arrive. Transcribing it again is
// offered exactly where the server would allow it: its author at any time but a live run, anyone
// else only a run that failed or stalled. With no `me`, only those last two.
export function VoiceMedia({ snap, me = '', tone = 'light' }: { snap: SnapView; me?: string; tone?: 'light' | 'dark' }) {
  const [voice, setVoice] = useState(snap.voice)
  useEffect(() => {
    if (voice?.status !== 'transcribing') return
    let cancelled = false
    const start = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (cancelled || Date.now() - start > 5 * 60 * 1000) return
      try {
        const res = await fetch(`${clientConfig().apiBase}/${snap.id}`)
        if (res.ok) { const s = await res.json() as SnapView; if (!cancelled) setVoice(s.voice) }
      } catch { /* retain the recording and retry while words are pending */ }
      finally { if (!cancelled) timer = setTimeout(tick, 4000) }
    }
    timer = setTimeout(tick, 4000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [snap.id, voice?.status])
  const retry = async () => {
    setVoice((v) => (v ? { ...v, status: 'transcribing', startedAt: new Date().toISOString() } : v))
    const res = await fetch(`${clientConfig().apiBase}/${snap.id}/voice/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    if (res?.ok) setVoice(((await res.json()) as SnapView).voice)
    else setVoice((v) => (v ? { ...v, status: 'failed', reason: 'the request did not reach the server' } : v))
  }
  const offer = mayRetranscribeVoice({ ...snap, voice }, me, new Date().toISOString())
  const again = (label: string) => offer ? <>{' '}<button type="button" onClick={retry} className="underline underline-offset-2">{label}</button></> : null
  return (
    <figure className="px-4 py-6">
      <figcaption className="mb-3 whitespace-pre-wrap text-[17px] leading-relaxed" style={{ color: tone === 'dark' ? '#ffffff' : INK, fontFamily: SERIF }}>
        {voice?.status === 'transcribing' ? <span style={{ color: MUTED }}>Writing down what was said…{again('Try again')}</span>
          : voice?.status === 'failed' ? (
            <span style={{ color: MUTED }}>
              {voice.reason ?? 'The words did not come through.'}{again('Try again')}
            </span>
          ) : <>{voice?.text}{offer && <span style={{ color: MUTED }}>{again('Transcribe again')}</span>}</>}
      </figcaption>
      {snap.audioUrl && <CompactAudio src={snap.audioUrl} label="Voice note" durationSec={voice?.durationSec} tone={tone} />}
    </figure>
  )
}
