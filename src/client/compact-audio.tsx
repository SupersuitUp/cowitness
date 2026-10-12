'use client'

import { useEffect, useRef, useState } from 'react'
import { INK, MUTED, HAIRLINE, ACCENT } from './theme.js'
import { formatClock } from './recorder.js'

/** Audio is an optional companion to the transcript, with usable touch and keyboard controls. */
export function CompactAudio({ src, label, durationSec = 0, tone = 'light' }: {
  src: string; label: string; durationSec?: number; tone?: 'light' | 'dark'
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(durationSec)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    const audio = ref.current
    generation.current += 1
    setPlaying(false); setPosition(0); setDuration(durationSec); setError(false)
    return () => { generation.current += 1; audio?.pause() }
  }, [src, durationSec])
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0
  const dark = tone === 'dark'
  const toggle = async () => {
    const audio = ref.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false); return }
    const gen = generation.current
    setError(false)
    try { await audio.play(); if (gen === generation.current) setPlaying(true) }
    catch { if (gen === generation.current) { setPlaying(false); setError(true) } }
  }
  return <div>
    <audio ref={ref} src={src} preload="metadata"
      onLoadedMetadata={() => { const d = ref.current?.duration; if (d && Number.isFinite(d)) setDuration(d) }}
      onDurationChange={() => { const d = ref.current?.duration; if (d && Number.isFinite(d)) setDuration(d) }}
      onTimeUpdate={() => setPosition(ref.current?.currentTime ?? 0)} onEnded={() => setPlaying(false)}
      onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setError(true) }} />
    <div className="flex items-center gap-3 rounded-2xl border px-3" style={{ color: dark ? '#ffffff' : INK, borderColor: dark ? '#ffffff40' : HAIRLINE }}>
      <button type="button" onClick={() => { void toggle() }} aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
        className="flex shrink-0 items-center justify-center rounded-full" style={{ minWidth: 44, minHeight: 44 }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
          {playing ? <path d="M5 3h4v14H5zm6 0h4v14h-4z" /> : <path d="M5 2.5 17 10 5 17.5z" />}
        </svg>
      </button>
      <input type="range" aria-label={`Position in ${label}`} min={0} max={total || 1} step={0.1}
        value={Math.min(position, total || 1)} disabled={!total}
        onChange={(e) => { const p = Number(e.target.value); if (ref.current) ref.current.currentTime = p; setPosition(p) }}
        className="min-w-0 flex-1 text-base" style={{ minHeight: 44, accentColor: dark ? '#ffffff' : ACCENT }} />
      <span className="shrink-0 text-xs tabular-nums" style={{ color: dark ? '#ffffffb3' : MUTED }}>{formatClock(position)} / {formatClock(total)}</span>
    </div>
    {error && <p role="alert" className="mt-1 text-sm">Could not play this recording. Try again.</p>}
  </div>
}
