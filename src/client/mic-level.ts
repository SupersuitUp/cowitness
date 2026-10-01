import { levelOf } from './hearing.js'

// The live level of the session's one microphone stream, for the meter and the silence floor.
export interface Listener { level(): number; close(): void }

type Ctor = typeof AudioContext
const ctor = (): Ctor | undefined =>
  typeof window === 'undefined' ? undefined
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext)

// Made INSIDE the Witness tap: Safari starts a context created outside a user gesture suspended,
// and a suspended analyser reads zero, which the silence floor would read as silence.
export function newAudioContext(): AudioContext | null {
  const C = ctor()
  return C ? new C() : null
}

export function analyserListener(stream: MediaStream, ctx: AudioContext | null = newAudioContext()): Listener | null {
  if (!ctx) return null
  let analyser: AnalyserNode
  try {
    analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
  } catch {
    // A context already closed. No level means the silence floor keeps everything (shouldKeep).
    return null
  }
  const frame = new Float32Array(analyser.fftSize)
  void ctx.resume?.().catch(() => {})
  return {
    level: () => { analyser.getFloatTimeDomainData(frame); return levelOf(frame) },
    close: () => { void ctx.close().catch(() => {}) },
  }
}
