import { describe, expect, it } from 'vitest'
import { parsePromptPatch, promptsDue } from './prompts.js'
import type { PromptPerson } from './types.js'

const TZ = 'America/Los_Angeles'
const at = (local: string) => new Date(`${local}-07:00`)
const both: PromptPerson[] = [
  { key: 'ana', times: ['08:30', '13:00', '19:00'], snoozedUntil: null },
  { key: 'ben', times: ['08:30', '13:00', '19:00'], snoozedUntil: null },
]

describe('promptsDue', () => {
  it('sends one reminder per due slot, to exactly one person', () => {
    const out = promptsDue(at('2026-10-01T08:35:00'), TZ, both, new Set())
    expect(out).toHaveLength(1)
    expect(out[0].slotKey).toBe('2026-10-01@08:30')
    expect(['ana', 'ben']).toContain(out[0].key)
  })
  it('takes turns across the day and from one day to the next', () => {
    const who = (local: string) => promptsDue(at(local), TZ, both, new Set())[0].key
    expect(who('2026-10-01T08:30:00')).not.toBe(who('2026-10-01T13:00:00'))
    expect(who('2026-10-01T13:00:00')).not.toBe(who('2026-10-01T19:00:00'))
    expect(who('2026-10-01T08:30:00')).not.toBe(who('2026-10-02T08:30:00'))
  })
  it('never repeats a slot already sent, and nothing is due outside the hour after a slot', () => {
    expect(promptsDue(at('2026-10-01T08:35:00'), TZ, both, new Set(['2026-10-01@08:30']))).toEqual([])
    expect(promptsDue(at('2026-10-01T10:00:00'), TZ, both, new Set())).toEqual([])
  })
  it('a 23:00 slot is still due at 23:50', () => {
    const late = [{ key: 'ana', times: ['23:00'], snoozedUntil: null }]
    expect(promptsDue(at('2026-10-01T23:50:00'), TZ, late, new Set())).toEqual([{ slotKey: '2026-10-01@23:00', key: 'ana' }])
  })
  it('skips a snoozed person, and goes quiet when everyone is', () => {
    const benSnoozed = [both[0], { ...both[1], snoozedUntil: '2026-10-01' }]
    for (const t of ['08:30', '13:00', '19:00']) expect(promptsDue(at(`2026-10-01T${t}:00`), TZ, benSnoozed, new Set())[0].key).toBe('ana')
    expect(promptsDue(at('2026-10-01T08:35:00'), TZ, both.map((p) => ({ ...p, snoozedUntil: '2026-10-01' })), new Set())).toEqual([])
  })
  it("honours each person's own times", () => {
    const own = [{ key: 'ana', times: ['07:00'], snoozedUntil: null }, { key: 'ben', times: ['21:00'], snoozedUntil: null }]
    expect(promptsDue(at('2026-10-01T07:10:00'), TZ, own, new Set())).toEqual([{ slotKey: '2026-10-01@07:00', key: 'ana' }])
    expect(promptsDue(at('2026-10-01T21:10:00'), TZ, own, new Set())).toEqual([{ slotKey: '2026-10-01@21:00', key: 'ben' }])
  })
})

describe('parsePromptPatch', () => {
  const current = { times: ['08:30'], snoozedUntil: null }
  it('saves times sorted and once each, and snoozes today', () => {
    expect(parsePromptPatch({ times: ['19:00', '08:30', '08:30'] }, current, '2026-09-30')).toEqual({ times: ['08:30', '19:00'], snoozedUntil: null })
    expect(parsePromptPatch({ snoozeToday: true }, current, '2026-09-30')).toEqual({ times: ['08:30'], snoozedUntil: '2026-09-30' })
    expect(parsePromptPatch({ snoozeToday: false }, { ...current, snoozedUntil: '2026-09-30' }, '2026-09-30')).toEqual({ times: ['08:30'], snoozedUntil: null })
  })
  it('refuses a malformed time and more than six', () => {
    expect(() => parsePromptPatch({ times: ['8:30pm'] }, current, '2026-09-30')).toThrow(/HH:MM/)
    expect(() => parsePromptPatch({ times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'] }, current, '2026-09-30')).toThrow(/six/)
  })
  it('refuses a time later than 23:00, and accepts 23:00', () => {
    expect(() => parsePromptPatch({ times: ['23:30'] }, current, '2026-09-30')).toThrow(/reminder times must be 23:00 or earlier/)
    expect(parsePromptPatch({ times: ['23:00'] }, current, '2026-09-30').times).toEqual(['23:00'])
  })
})
