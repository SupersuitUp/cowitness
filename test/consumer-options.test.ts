// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Person, Snap } from '../src/index.js'
import { fakeFirestore } from './support/fake-firestore.js'
import { optionsHome, optionsHostWith, type Told } from './consumer/lib/host-options.js'

// The consumer app's options host is the worked example an app copies, so what it does with an
// announcement is held to the package's own rule: every recipient checked with mayHear.
type K = 'a' | 'b' | 'c'
const snap = (extra: Partial<Snap<K>> = {}) => ({
  id: 's1', by: 'a', caption: '', kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 1, height: 1,
  paths: { original: '', display: '', thumb: '' }, witnessedAt: null, hiddenAt: null, createdAt: '2026-09-27T14:03:00Z', ...extra,
}) as Snap<K>
const comment = { id: 'c1', by: 'b', text: 'hi', at: '2026-09-27T14:04:00Z' } as never

async function everyMoment(s: Snap<K>) {
  const told: Told[] = []
  const host = optionsHostWith({ deliver: (t) => { told.push(t) } })
  await host.announce.shared('a', s)
  await host.announce.witnessed('b', s, 'hello')
  await host.announce.message('b', s, comment)
  await host.announce.heart('b', s, comment)
  await host.announce.spoken!('b', s, comment)
  await host.announce.tagged!('a', s, ['t-first'])
  return told
}

describe('the consumer options host tells people only what they may hear', () => {
  it('a "just us" snap never reaches a person who only witnesses, through any announcement', async () => {
    const told = await everyMoment(snap({ justUs: true }))
    expect(told.length).toBeGreaterThan(0)
    expect(told.filter((t) => t.to === 'c')).toEqual([])
    expect(new Set(told.map((t) => t.what))).toEqual(new Set(['shared', 'witnessed', 'message', 'heart', 'spoken', 'tagged']))
  })

  it('an ordinary snap reaches everyone but the person who acted', async () => {
    const told = await everyMoment(snap())
    expect(told.filter((t) => t.what === 'shared').map((t) => t.to).sort()).toEqual(['b', 'c'])
    expect(told.filter((t) => t.what === 'witnessed').map((t) => t.to).sort()).toEqual(['a', 'c'])
  })

  it('a hidden snap is told to no one but its author', async () => {
    const told = await everyMoment(snap({ hiddenAt: '2026-09-27T15:00:00Z' }))
    expect(told.every((t) => t.to === 'a')).toBe(true)
  })
})

describe('the consumer makes a store per request', () => {
  it('asks who the people are once for a whole page, and again for the next request', async () => {
    const who: Person<K>[] = [{ key: 'a', role: 'shares' }, { key: 'b', role: 'shares' }, { key: 'c', role: 'witnesses' }]
    const people = vi.fn(async () => who)
    const f = fakeFirestore()
    const host = { ...optionsHostWith({ people }), db: () => f.db as never }
    const first = await optionsHome('c', host)
    expect(first.can).toEqual({ share: false, witness: true })
    expect(first.tagChoices).toEqual([{ id: 't-first', label: 'First' }])
    expect(people).toHaveBeenCalledTimes(1)
    await optionsHome('a', host)
    expect(people).toHaveBeenCalledTimes(2)
  })
})
