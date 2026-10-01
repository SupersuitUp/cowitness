import { describe, expect, it } from 'vitest'
import { startTally, tally, heardSpeech, shouldKeep, SPEECH_LEVEL, MAX_FRAME_GAP_MS } from './speech.js'

const run = (levels: number[], stepMs = 100) =>
  levels.reduce((t, level, i) => tally(t, level, 1000 + i * stepMs), startTally())

describe('the silence floor', () => {
  it('counts only the time spent at or above speech level', () => {
    expect(run([0.05, 0.05, 0.05]).speechMs).toBe(200)
    expect(run([0.05, 0.001, 0.05]).speechMs).toBe(100)
  })

  it('a second of talking is a reaction; a cough is not', () => {
    expect(heardSpeech(run(Array(12).fill(0.05)))).toBe(true)
    expect(heardSpeech(run(Array(5).fill(0.05)))).toBe(false)
  })

  it('a stalled meter never counts a long gap as speech', () => {
    const t = tally(tally(startTally(), 0.05, 0), 0.05, 5000)
    expect(t.speechMs).toBe(MAX_FRAME_GAP_MS)
  })

  it('keeps a reaction it could not measure, because losing words is worse than keeping silence', () => {
    expect(shouldKeep(run([0, 0, 0]))).toBe(true)
    expect(shouldKeep(run([0.001, 0.002, 0.001]))).toBe(false)
    expect(shouldKeep(run(Array(12).fill(SPEECH_LEVEL)))).toBe(true)
  })
})
