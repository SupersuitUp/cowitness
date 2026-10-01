import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, inWindow, minutesOf, weekStart, zoned } from './zoned.js'

describe('zoned', () => {
  it('reads the day and the time in the zone, not the server\'s', () => {
    expect(zoned(new Date('2026-10-01T06:00:00Z'), 'America/Los_Angeles')).toEqual({ dayKey: '2026-09-30', hhmm: '23:00' })
    expect(zoned(new Date('2026-10-01T06:00:00Z'), 'UTC')).toEqual({ dayKey: '2026-10-01', hhmm: '06:00' })
  })
  it('reads midnight as 00 and follows the zone across a clock change', () => {
    expect(zoned(new Date('2026-10-01T07:05:00Z'), 'America/Los_Angeles').hhmm).toBe('00:05')
    expect(zoned(new Date('2026-11-01T07:30:00Z'), 'America/Los_Angeles')).toEqual({ dayKey: '2026-11-01', hhmm: '00:30' })
    expect(zoned(new Date('2026-11-01T09:30:00Z'), 'America/Los_Angeles')).toEqual({ dayKey: '2026-11-01', hhmm: '01:30' })
    expect(zoned(new Date('2026-11-01T12:00:00Z'), 'America/Los_Angeles')).toEqual({ dayKey: '2026-11-01', hhmm: '04:00' })
  })
  it('counts days across a clock change without gaining or losing one', () => {
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02')
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('starts a week on Monday', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28')
    expect(weekStart('2026-09-28')).toBe('2026-09-28')
    expect(weekStart('2026-09-27')).toBe('2026-09-21')
  })
  it('keeps a slot due for the hour after it', () => {
    expect(inWindow('08:30', '08:30')).toBe(true)
    expect(inWindow('08:30', '09:29')).toBe(true)
    expect(inWindow('08:30', '09:30')).toBe(false)
    expect(inWindow('08:30', '08:29')).toBe(false)
    expect(minutesOf('01:05')).toBe(65)
  })
})
