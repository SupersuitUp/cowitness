import { describe, expect, it } from 'vitest'
import { levelOf, hearing, meterWidth, SOUND_FLOOR, QUIET_SEC } from './hearing.js'

const tone = (n: number, amplitude: number) =>
  Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((i / n) * Math.PI * 8))

describe('is it hearing the speaker', () => {
  it('reads silence as nothing and speech as something', () => {
    expect(levelOf(new Float32Array(128))).toBe(0)
    expect(levelOf(new Float32Array(0))).toBe(0)
    const quiet = levelOf(tone(1024, 0.002))
    const speech = levelOf(tone(1024, 0.2))
    expect(quiet).toBeLessThan(SOUND_FLOOR)
    expect(speech).toBeGreaterThan(SOUND_FLOOR)
  })

  it('does not cry quiet during an ordinary pause for thought', () => {
    expect(hearing(0, 1)).toBe('listening')
    expect(hearing(0, QUIET_SEC - 0.5)).toBe('listening')
  })

  it('says so when nothing has come through for long enough to be a dead microphone', () => {
    expect(hearing(0, QUIET_SEC)).toBe('quiet')
    expect(hearing(SOUND_FLOOR / 2, 60)).toBe('quiet')
    // One moment of real sound in the window is enough: they are being heard, just pausing.
    expect(hearing(SOUND_FLOOR, 60)).toBe('listening')
    expect(hearing(0.3, 600)).toBe('listening')
  })

  it('spends the meter on the range speech actually occupies', () => {
    expect(meterWidth(0)).toBe(0)
    expect(meterWidth(1)).toBe(100)
    expect(meterWidth(2)).toBe(100)
    expect(meterWidth(-1)).toBe(0)
    // Ordinary talking has to MOVE it. A linear meter leaves 0.1 down at a tenth of the bar.
    expect(meterWidth(0.1)).toBeGreaterThan(45)
    expect(meterWidth(0.3)).toBeGreaterThan(meterWidth(0.1))
  })
})
