import { describe, expect, it } from 'vitest'
import { snapRow } from './format.js'
import { assertMayRetranscribeVoice, isVoiceRun, voiceSnapPaths, failVoiceTranscript, markVoiceTranscribing, newVoiceSnap, setVoiceTranscript, validateClientId, voiceSnapPath } from './voice-rules.js'

const NOW = '2026-09-30T12:00:00.000Z'
const voice = { path: 'p/snaps-voice/v-abcdefgh.m4a', contentType: 'audio/mp4', durationSec: 9, status: 'transcribing' as const, text: '' }

describe('a voice snap', () => {
  it('is a snap with no picture, its words still to come', () => {
    const s = { id: 'v-abcdefgh', ...newVoiceSnap('ana', voice, '', NOW, {}) }
    expect(s).toMatchObject({ kind: 'voice', width: 0, height: 0, paths: { original: '', display: '', thumb: '' }, voice, witnessedAt: null, hiddenAt: null, takenAt: NOW })
    expect(snapRow(s)).toMatchObject({ kind: 'voice', durationSec: 9, words: '' })
  })
  it('lives beside the app\'s other files under one id the phone chose', () => {
    expect(voiceSnapPath('p/', 'v-abcdefgh', 'audio/webm')).toBe('p/snaps-voice/v-abcdefgh.webm')
    expect(validateClientId('v-abcdefgh', 'snapId')).toBe('v-abcdefgh')
    expect(() => validateClientId('../x', 'snapId')).toThrow(/snapId must be/)
  })
  it('gets its words, or a reason, and starts again cleanly', () => {
    const s = { id: 'v1', ...newVoiceSnap('ana', voice, '', NOW, {}) }
    expect(setVoiceTranscript(s, '  hello  ').voice).toEqual({ path: voice.path, contentType: 'audio/mp4', durationSec: 9, text: 'hello' })
    expect(failVoiceTranscript(s, 'too quiet').voice).toMatchObject({ status: 'failed', reason: 'too quiet' })
    expect(setVoiceTranscript(s, '   ').voice).toMatchObject({ status: 'failed', reason: 'nothing was heard in that recording' })
    expect(markVoiceTranscribing(failVoiceTranscript(s, 'x'), 'fr', { now: NOW }).voice).toMatchObject({ status: 'transcribing', language: 'fr', startedAt: NOW })
  })
  it('writes "just us" and tags only when they are there, and a row carries them', () => {
    const s = { id: 'v1', ...newVoiceSnap('ana', voice, '', NOW, { justUs: true, tags: ['t-first'] }) }
    expect(s).toMatchObject({ justUs: true, tags: ['t-first'] })
    expect(snapRow(s)).toMatchObject({ justUs: true, tags: ['t-first'] })
    const plain = { id: 'v2', ...newVoiceSnap('ana', voice, '', NOW, { tags: [] }) }
    expect('justUs' in plain || 'tags' in plain).toBe(false)
    expect(Object.keys(snapRow(plain))).not.toContain('justUs')
  })
  it('has one path per type for an id, and knows which run may still write', () => {
    expect(voiceSnapPaths('p/', 'v-abcdefgh')).toContain('p/snaps-voice/v-abcdefgh.m4a')
    expect(new Set(voiceSnapPaths('p/', 'v-abcdefgh')).size).toBe(voiceSnapPaths('p/', 'v-abcdefgh').length)
    const s = { id: 'v1', ...newVoiceSnap('ana', voice, '', NOW, {}) }
    const running = markVoiceTranscribing(s, undefined, { now: NOW })
    expect(isVoiceRun(running, NOW)).toBe(true)
    expect(isVoiceRun(running, '2026-09-30T11:00:00.000Z')).toBe(false)
    expect(isVoiceRun(setVoiceTranscript(running, 'hi'), NOW)).toBe(false)
  })
  it('lets the author redo words, and anyone else only a failed or stalled run', () => {
    const s = { id: 'v1', ...newVoiceSnap('ana', voice, '', NOW, {}) }
    const done = setVoiceTranscript(s, 'hi')
    expect(() => assertMayRetranscribeVoice(done, 'ana', NOW)).not.toThrow()
    expect(() => assertMayRetranscribeVoice(done, 'ben', NOW)).toThrow(/only the person who shared it/)
    expect(() => assertMayRetranscribeVoice(failVoiceTranscript(s, 'x'), 'ben', NOW)).not.toThrow()
    const live = markVoiceTranscribing(s, undefined, { now: NOW })
    expect(() => assertMayRetranscribeVoice(live, 'ana', NOW)).toThrow(/still being transcribed/)
    expect(() => assertMayRetranscribeVoice(live, 'ben', '2026-09-30T12:06:00.000Z')).not.toThrow()
  })
})
