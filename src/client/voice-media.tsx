'use client'

import { useState } from 'react'
import type { SnapView } from '../types.js'
import { mayRetranscribeVoice } from '../voice-rules.js'
import { clientConfig } from './config.js'
import { INK, MUTED, SERIF } from './theme.js'

// A voice snap: the recording, and its words under it once they arrive. Transcribing it again is
// offered exactly where the server would allow it: its author at any time but a live run, anyone
// else only a run that failed or stalled. With no `me`, only those last two.
export function VoiceMedia({ snap, me = '' }: { snap: SnapView; me?: string }) {
  const [voice, setVoice] = useState(snap.voice)
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
      <audio src={snap.audioUrl} controls preload="metadata" className="w-full" />
      <figcaption className="mt-3 whitespace-pre-wrap text-[17px] leading-relaxed" style={{ color: INK, fontFamily: SERIF }}>
        {voice?.status === 'transcribing' ? <span style={{ color: MUTED }}>Writing down what was said…{again('Try again')}</span>
          : voice?.status === 'failed' ? (
            <span style={{ color: MUTED }}>
              {voice.reason ?? 'The words did not come through.'}{again('Try again')}
            </span>
          ) : <>{voice?.text}{offer && <span style={{ color: MUTED }}>{again('Transcribe again')}</span>}</>}
      </figcaption>
    </figure>
  )
}
