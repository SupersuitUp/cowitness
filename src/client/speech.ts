// Whether anything was SAID, measured on the phone from the level the meter already reads, so
// deciding costs nothing to run and nothing leaves the phone to decide it. A reaction with under
// about a second of speech is not stored: a blank voice note under every snap the reader moved past in
// silence would turn the thread into noise.

/** RMS at or above which a frame counts as someone talking. Twice hearing.ts's dead-input floor. */
export const SPEECH_LEVEL = 0.02
export const SPEECH_FLOOR_SEC = 1
/** A stalled meter (a backgrounded tab) must never credit a long gap as speech. */
export const MAX_FRAME_GAP_MS = 250

export interface SpeechTally { speechMs: number; lastAt: number | null; maxLevel: number }

export const startTally = (): SpeechTally => ({ speechMs: 0, lastAt: null, maxLevel: 0 })

export function tally(t: SpeechTally, level: number, at: number): SpeechTally {
  const gap = t.lastAt === null ? 0 : Math.min(Math.max(0, at - t.lastAt), MAX_FRAME_GAP_MS)
  return {
    speechMs: t.speechMs + (level >= SPEECH_LEVEL ? gap : 0),
    lastAt: at,
    maxLevel: Math.max(t.maxLevel, level),
  }
}

export const heardSpeech = (t: SpeechTally) => t.speechMs >= SPEECH_FLOOR_SEC * 1000

// A meter that read exactly nothing the whole time was not measuring (an AudioContext Safari
// left suspended, or none at all): keep the recording rather than throw away words unheard.
export const shouldKeep = (t: SpeechTally) => t.maxLevel === 0 || heardSpeech(t)
