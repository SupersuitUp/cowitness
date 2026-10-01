import { describe, expect, it } from 'vitest'
import {
  pickMimeType, formatClock, nearCap, atCap, voiceFailure, NOTHING_HEARD_NOTE,
  RECORD_MAX_SEC, AUDIO_BITS_PER_SECOND, MIC_CONSTRAINTS, SESSION_MIC_CONSTRAINTS,
} from './recorder.js'
import { CLIP_MAX_BYTES, NOTHING_HEARD } from '../shared-rules.js'

// Vercel refuses any request body over 4.5 MB with a plain-text 413 before the route runs, so
// what a recording WEIGHS is the thing that used to decide whether it survived.
const VERCEL_BODY_MAX = 4.5 * 1024 * 1024

describe('recorder', () => {
  it('prefers webm/opus, falls back to mp4 on Safari, and admits when it cannot record', () => {
    expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickMimeType(() => false)).toBe('')
  })

  it('shows a clock and stops at twenty minutes', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(RECORD_MAX_SEC)).toBe('20:00')
    expect(nearCap(1169)).toBe(false); expect(nearCap(1170)).toBe(true)
    expect(atCap(1199)).toBe(false); expect(atCap(1200)).toBe(true)
  })

  it('records mono at a bitrate that keeps a full twenty minutes well under the clip limit', () => {
    expect(MIC_CONSTRAINTS.channelCount).toBe(1)
    const bytesAtCap = (AUDIO_BITS_PER_SECOND / 8) * RECORD_MAX_SEC
    expect(bytesAtCap).toBeLessThan(CLIP_MAX_BYTES / 4)
    // An old client that still posts the bytes through the function also still carries its old
    // ten-minute stop, so what it can send must fit a request body. The new cap goes to storage.
    expect((AUDIO_BITS_PER_SECOND / 8) * 600).toBeLessThan(VERCEL_BODY_MAX)
  })

  it('a reaction stops at three minutes and warns in its last thirty seconds', () => {
    expect(nearCap(149, 180)).toBe(false); expect(nearCap(150, 180)).toBe(true)
    expect(atCap(179, 180)).toBe(false); expect(atCap(180, 180)).toBe(true)
  })

  it('the session mic cancels the video\'s own sound, in mono', () => {
    expect(SESSION_MIC_CONSTRAINTS).toEqual({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true })
  })

  describe('voiceFailure', () => {
    it('never hands back a bare code, and always says where the recording now is', () => {
      const beforeUpload = voiceFailure('upload', 0)
      expect(beforeUpload).toContain('still on this page')
      expect(voiceFailure('ticket', 500)).toContain('still on this page')
      const afterUpload = voiceFailure('transcribe', 500)
      expect(afterUpload).toContain('under Recordings')
      expect(afterUpload).not.toContain('still on this page')
    })

    it('passes a server refusal through as a sentence rather than a fragment', () => {
      expect(voiceFailure('transcribe', 400, 'the recording could not be made out'))
        .toBe('The recording could not be made out. The recording itself was saved. It is under Recordings below, and you can try again.')
      expect(voiceFailure('upload', 400, 'recording is too large.')).toContain('Recording is too large.')
    })

  it('a recording where nobody spoke is a gentle note, not an error, and says nothing was added', () => {
    const m = voiceFailure('transcribe', 200, NOTHING_HEARD)
    expect(m).toBe(NOTHING_HEARD_NOTE)
    expect(m).toContain('Nothing was heard')
    expect(m).toContain('nothing was added to the note')
    expect(m).toContain('Recordings')
  })

  it('explains the 413 an old open tab can still hit, which said nothing at all before', () => {
      const m = voiceFailure('upload', 413)
      expect(m).toContain('too big to send in one request')
      expect(m).toContain('Reload')
    })

    it('says plainly when the answer was that the person is signed out', () => {
      expect(voiceFailure('ticket', 403)).toContain('signed out')
      expect(voiceFailure('transcribe', 401)).toContain('signed out')
    })

    it('reads as sentences, with no stray punctuation from an empty reason', () => {
      for (const m of [voiceFailure('upload', 0), voiceFailure('transcribe', 500, '  '), voiceFailure('ticket', 502)]) {
        expect(m).toMatch(/^[A-Z]/)
        expect(m).not.toContain('..')
        expect(m).not.toContain('undefined')
      }
    })
  })
})
