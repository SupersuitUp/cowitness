import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CowitnessHome } from './cowitness-home.js'
import { SnapsArchive } from './snaps-archive.js'
import { SnapDetail } from './snap-detail.js'
import { askPeopleOnce, createCowitnessStore } from '../server/store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { CowitnessHost } from '../server/host.js'
import type { Person } from '../features.js'

// From the store to the screen: what each person is drawn, with the options on.
const NAMES = { ana: 'Ana', ben: 'Ben', cy: 'Cy' }
const stored = (by: M, o: Record<string, unknown> = {}) => ({
  by, caption: '', kind: 'photo', takenAt: '2026-09-30T08:00:00', width: 3, height: 4,
  paths: { original: 'p/original/x.jpg', display: 'p/display/x.jpg', thumb: 'p/thumb/x.jpg' },
  witnessedAt: null, hiddenAt: null, createdAt: '2026-09-30T08:00:00.000Z', ...o,
})
const PRIVATE = { original: 'p/original/kept.jpg', display: 'p/display/kept.jpg', thumb: 'p/thumb/kept.jpg' }

function setup(who: Person<M>[], snaps: Record<string, unknown>) {
  const { host, f } = fakeHost({ features: { witnessing: 'audience', justUs: true } })
  f.seed(host.collection, snaps)
  const h: CowitnessHost<M> = { ...host, people: async () => who }
  return createCowitnessStore(askPeopleOnce(h))
}

async function everyScreen(store: ReturnType<typeof setup>, m: M) {
  const home = await store.listCowitness(m)
  const can = await store.whoAmI(m)
  const { container } = render(<>
    <CowitnessHome {...home} me={m} names={NAMES} can={can} />
    <SnapsArchive rows={await store.listWitnessed(m)} me={m} names={NAMES} />
    <SnapsArchive rows={(await store.listSnaps(m)).map((s) => ({ id: s.id, by: s.by, caption: s.caption, kind: s.kind, thumbUrl: s.thumbUrl, durationSec: null, createdAt: s.createdAt, witnessedAt: s.witnessedAt, hidden: s.hiddenAt !== null }))} me={m} names={NAMES} />
  </>)
  return { html: container.innerHTML, home, can }
}

describe('"just us" is never drawn for a person who only witnesses', () => {
  it('not on today, the queue, the shelf, the archive, a snap of its own, the cover, the count or the new mark', async () => {
    // ben shares and witnesses, and has seen the private one, so it would sit on a shelf if it leaked.
    const store = setup([{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'both' }, { key: 'cy', role: 'witnesses' }], {
      kept: stored('ana', { caption: 'tavo merin', justUs: true, paths: PRIVATE, createdAt: '2026-09-30T12:00:00.000Z', witnessedAt: '2026-09-30T13:00:00.000Z', witnessedBy: { ben: '2026-09-30T13:00:00.000Z', cy: '2026-09-30T13:00:00.000Z' } }),
      open: stored('ana', { caption: 'solut vadis', createdAt: '2026-09-30T08:00:00.000Z' }),
    })
    const { html, home } = await everyScreen(store, 'cy')
    expect(html).not.toContain('tavo merin')
    expect(html).not.toContain('/cowitness/kept')
    expect(html).not.toContain('kept.jpg')
    expect(screen.getByRole('button', { name: 'Witness (1)' })).toBeInTheDocument()
    expect(home.streak.map((r) => r.id)).toEqual(['open'])
    expect(await store.getSnapView('cy', 'kept')).toBeNull()
    // The private one is the newest, and still it is neither the cover, nor counted, nor new.
    expect(await store.cowitnessSummary('cy', '2026-09-30T10:00:00.000Z')).toEqual({ count: 1, coverUrl: 'signed:p/thumb/x.jpg', hasNew: false, waiting: 1 })
    // A person who shares sees it, so the snap is real and only kept from the witness.
    const ben = await everyScreen(store, 'ben')
    expect(ben.html).toContain('/cowitness/kept')
  })
})

describe('each witness has their own seen; a person who only shares reads the first', () => {
  const seen = { open: stored('ana', { caption: 'solut vadis', witnessedAt: '2026-09-30T09:00:00.000Z', witnessedBy: { cy: '2026-09-30T09:00:00.000Z' } }) }
  it('a person who shares and witnesses still has it waiting after another witness saw it', async () => {
    const store = setup([{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'both' }, { key: 'cy', role: 'witnesses' }], seen)
    await everyScreen(store, 'ben')
    expect(screen.getByRole('button', { name: 'Witness (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Witnessed/ })).toBeNull()
  })
  it('a person who only shares finds it on the shelf, and its sharer is told who saw it', async () => {
    const store = setup([{ key: 'ana', role: 'shares' }, { key: 'ben', role: 'shares' }, { key: 'cy', role: 'witnesses' }], seen)
    const { can } = await everyScreen(store, 'ben')
    expect(can).toEqual({ share: true, witness: false })
    expect(screen.queryByRole('button', { name: /Witness \(/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Witnessed (1) ›' })).toBeInTheDocument()
    const view = await store.getSnapView('ana', 'open')
    render(<SnapDetail snap={view!} me="ana" names={NAMES} />)
    expect(screen.getByText(/· Seen by Cy$/)).toBeInTheDocument()
  })
})
