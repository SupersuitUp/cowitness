// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<unknown>) => { void fn() } }))
import { createCowitnessStore } from './store.js'
import { createCowitnessHandlers } from './handlers.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { PromptPerson, PromptSettings } from '../types.js'

function setup(people: PromptPerson<M>[] = [{ key: 'ana', times: ['08:30'], snoozedUntil: null }]) {
  const { host, f } = fakeHost()
  const saved: [M, PromptSettings][] = []
  const nudge = vi.fn()
  const withPrompts = {
    ...host, features: { prompts: true },
    prompts: { collection: 'snaps_prompts', timeZone: 'America/Los_Angeles', people: async () => people, save: async (m: M, s: PromptSettings) => { saved.push([m, s]) }, nudge },
  }
  const store = createCowitnessStore(withPrompts)
  return { host: withPrompts, store, f, saved, nudge, h: createCowitnessHandlers(withPrompts, store) }
}
const AT = new Date('2026-10-01T08:35:00-07:00')

describe('sending reminders', () => {
  it('claims the slot, then nudges one person', async () => {
    const { store, nudge, f } = setup()
    expect(await store.sendDuePrompts(AT)).toEqual(['2026-10-01@08:30'])
    expect(nudge).toHaveBeenCalledWith('ana', '2026-10-01@08:30')
    expect(f.raw('snaps_prompts', '2026-10-01@08:30')).toMatchObject({ dayKey: '2026-10-01', person: 'ana' })
  })
  it('sends a slot once even when two runs overlap, and not again later in the hour', async () => {
    const { store, nudge } = setup()
    await Promise.all([store.sendDuePrompts(AT), store.sendDuePrompts(AT)])
    expect(await store.sendDuePrompts(new Date('2026-10-01T08:45:00-07:00'))).toEqual([])
    expect(nudge).toHaveBeenCalledTimes(1)
  })
  it('a late run and a repeated run never send the same slot on the same day twice', async () => {
    const { store, nudge } = setup()
    expect(await store.sendDuePrompts(new Date('2026-10-01T09:20:00-07:00'))).toEqual(['2026-10-01@08:30'])
    expect(await store.sendDuePrompts(new Date('2026-10-01T09:20:00-07:00'))).toEqual([])
    expect(await store.sendDuePrompts(new Date('2026-10-01T09:29:00-07:00'))).toEqual([])
    expect(nudge).toHaveBeenCalledTimes(1)
    // the next day's slot is a new slot
    expect(await store.sendDuePrompts(new Date('2026-10-02T08:35:00-07:00'))).toEqual(['2026-10-02@08:30'])
    expect(nudge).toHaveBeenCalledTimes(2)
  })
  it('keeps the claim when a nudge throws, and logs it', async () => {
    const { store, nudge, host } = setup()
    const log = vi.fn()
    Object.assign(host, { log })
    nudge.mockRejectedValueOnce(new Error('push service down'))
    expect(await store.sendDuePrompts(AT)).toEqual(['2026-10-01@08:30'])
    expect(await store.sendDuePrompts(AT)).toEqual([])
    expect(log).toHaveBeenCalledWith('prompts.nudge failed', expect.any(Error))
  })
  it('refuses where reminders are off', async () => {
    const store = createCowitnessStore(fakeHost().host)
    await expect(store.sendDuePrompts(AT)).rejects.toMatchObject({ status: 404 })
  })
})

describe("a person's own times", () => {
  it('reads them with today, and saves a change through the app', async () => {
    const { h, host, saved } = setup()
    vi.mocked(host.member).mockResolvedValue('ana')
    const read = await h.prompts.GET(new Request('https://x'))
    expect(await read.json()).toMatchObject({ times: ['08:30'], snoozedUntil: null, today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    const res = await h.prompts.PATCH(new Request('https://x', { method: 'PATCH', body: JSON.stringify({ times: ['19:00', '07:00'] }) }))
    expect(res.status).toBe(200)
    expect(saved).toEqual([['ana', { times: ['07:00', '19:00'], snoozedUntil: null }]])
  })
  it('refuses a reminder time after 23:00 with a clear 400', async () => {
    const { h, host } = setup()
    vi.mocked(host.member).mockResolvedValue('ana')
    const res = await h.prompts.PATCH(new Request('https://x', { method: 'PATCH', body: JSON.stringify({ times: ['23:30'] }) }))
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/23:00 or earlier/)
  })
  it('is refused to anyone who is not reminded', async () => {
    const { h, host } = setup()
    vi.mocked(host.member).mockResolvedValue('ben')
    expect((await h.prompts.PATCH(new Request('https://x', { method: 'PATCH', body: '{"snoozeToday":true}' }))).status).toBe(403)
  })
})
