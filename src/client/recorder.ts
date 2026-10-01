// Everything about a recording that is not the DOM: which mime type this browser can make,
// how it is encoded, the clock, the hard stop, and what to say when a recording does not
// become a transcript. The component owns MediaRecorder; this is what it decides with.

import { NOTHING_HEARD } from '../shared-rules.js'

export const RECORD_MAX_SEC = 1200

// Chrome hands a getUserMedia stream to MediaRecorder as stereo at roughly 210 kbps, which is
// studio bitrate for one person talking: measured against the real clips in the bucket, a
// recording grew about 26 KB every second, so three minutes of it already outweighed a
// serverless request body. Mono opus at 48 kbps is plenty for speech, keeps the old ten-minute
// cap under that body limit (so an old client still posting bytes survives its own stop), puts
// the twenty-minute cap near 7 MB on the storage path, and gets there fast on a phone.
export const AUDIO_BITS_PER_SECOND = 48_000
export const MIC_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1 }

// Chrome and Firefox make webm/opus; Safari (and every iPhone) makes mp4/aac. Ask in that order
// and take the first the browser admits to. An empty answer means MediaRecorder cannot run here.
export function pickMimeType(supported: (t: string) => boolean): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(supported) ?? ''
}

export const formatClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

// A recording stops itself at the cap; the last thirty seconds are shown so nobody is cut off
// mid-thought by surprise. Notes use twenty minutes; a Cowitness reaction passes its own three.
export const nearCap = (sec: number, max = RECORD_MAX_SEC) => sec >= max - 30
export const atCap = (sec: number, max = RECORD_MAX_SEC) => sec >= max

// The witness session listens while a video plays with sound, so the phone's own echo
// cancellation is what keeps the video out of the voice. The first real session tells us
// whether it is enough; if not, the fallback is opening the mic when the video ends.
export const SESSION_MIC_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }

// Where a recording was when it failed, which is the only thing that decides whether it still
// exists anywhere. Before `transcribe` the bytes live nowhere but this page; from `transcribe`
// on they are in storage and attached to the note, so the words can be told the truth.
export type VoiceStage = 'ticket' | 'upload' | 'transcribe'

// A failure is only useful if it says what happened and what to do about it. The server's own
// refusals are already written for a reader and are passed through; everything else would
// otherwise reach the person as a status code or as nothing at all.
// A recording where nobody spoke: nothing is wrong and nothing is lost, so it reads as a note.
export const NOTHING_HEARD_NOTE =
  'Nothing was heard in that recording, so nothing was added to the note. The recording itself was saved under Recordings below.'

export function voiceFailure(stage: VoiceStage, status: number, error?: string): string {
  if (status === 413) {
    return 'That recording was too big to send in one request. Reload this page and recordings go straight to storage instead, however long they are.'
  }
  if (status === 401 || status === 403) return 'You were signed out. Sign in again, then try this recording once more.'
  if (stage === 'transcribe') {
    if (error?.trim() === NOTHING_HEARD) return NOTHING_HEARD_NOTE
    const why = error?.trim() ? sentence(error) : 'The transcription did not come back.'
    return `${why} The recording itself was saved. It is under Recordings below, and you can try again.`
  }
  const why = error?.trim()
    ? sentence(error)
    : status === 0
      ? 'The upload stopped before it finished, usually a connection that dropped.'
      : `The upload was refused (${status}).`
  return `${why} The recording is still on this page, so you can try again without recording it over.`
}

// Server refusals are written as lowercase fragments ('note is full'); on screen they are read
// as a sentence, so they get a capital and a full stop and nothing else.
function sentence(s: string): string {
  const t = s.trim().replace(/[.!?]+$/, '')
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ''
}
