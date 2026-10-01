import { describe, expect, it } from 'vitest'
import { begin, isDone, advance, witnessPatch, isSwipeUp, progressLabel } from './witness-flow.js'

describe('a witness session', () => {
  it('walks forward only, and ends after the last', () => {
    let s = begin(2)
    expect(progressLabel(s)).toBe('1 of 2')
    s = advance(s)
    expect(progressLabel(s)).toBe('2 of 2')
    expect(isDone(s)).toBe(false)
    s = advance(s)
    expect(isDone(s)).toBe(true)
    expect(advance(s).index).toBe(2)
    expect(isDone(begin(0))).toBe(true)
  })
  it('Next sends typed words when there are some, and a bare witness when there are none', () => {
    expect(witnessPatch('  so good ')).toEqual({ kind: 'witness', text: 'so good' })
    expect(witnessPatch('   ')).toEqual({ kind: 'witness' })
  })
  it('a swipe up is at least sixty pixels upward', () => {
    expect(isSwipeUp(500, 430)).toBe(true)
    expect(isSwipeUp(500, 440)).toBe(true)
    expect(isSwipeUp(500, 450)).toBe(false)
    expect(isSwipeUp(400, 500)).toBe(false)
  })
})
