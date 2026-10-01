import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { golden } from './golden.js'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CowitnessHome } from '../../src/client/cowitness-home.js'
import { SnapDetail } from '../../src/client/snap-detail.js'
import { SnapsArchive } from '../../src/client/snaps-archive.js'
import { StreakStrip } from '../../src/client/streak-strip.js'
import { AddSnap } from '../../src/client/add-snap.js'
import { snapRow } from '../../src/format.js'
import type { SnapView } from '../../src/types.js'

const NAMES = { ana: 'Ana', ben: 'Ben' }
const view = (id: string, by: string, o: Partial<SnapView> = {}): SnapView => ({
  id, by, caption: 'a caption', kind: 'photo', takenAt: '2026-09-30T08:00:00', width: 3, height: 4,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null,
  createdAt: '2026-09-30T09:00:00.000Z', thumbUrl: 'https://img/t', displayUrl: 'https://img/d', ...o,
})
const snaps = [
  view('s1', 'ben'),
  view('s2', 'ana', { witnessedAt: '2026-09-30T10:00:00.000Z', createdAt: '2026-09-29T09:00:00.000Z' }),
  view('s3', 'ana', { kind: 'video', video: { path: 'v', posterPath: null, durationSec: 7, contentType: 'video/mp4' }, thumbUrl: null, displayUrl: null, videoUrl: 'https://img/v', posterUrl: null }),
  view('s4', 'ben', { hiddenAt: '2026-09-30T11:00:00.000Z' }),
]
const rows = snaps.map((s) => snapRow(s, s.thumbUrl))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-09-30T20:00:00.000Z')) })
afterAll(() => { vi.useRealTimers() })

describe('options off: every screen is 0.1.3', () => {
  it('reproduces the recorded screens', () => {
    const html = (el: ReactElement) => render(el).container.innerHTML
    golden('screens', {
      home: html(<CowitnessHome rows={rows.slice(0, 1)} streak={rows} witnessed={1} queue={[snaps[0]]} me="ana" names={NAMES} />),
      homeEmpty: html(<CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[]} me="ana" names={NAMES} />),
      detailMine: html(<SnapDetail snap={{ ...snaps[1], comments: [{ id: 'c1', by: 'ben', text: 'lovely', at: '2026-09-30T10:00:00.000Z' }] }} me="ana" names={NAMES} />),
      detailVideo: html(<SnapDetail snap={snaps[2]} me="ben" names={NAMES} />),
      archive: html(<SnapsArchive rows={rows} me="ana" names={NAMES} />),
      archiveEmpty: html(<SnapsArchive rows={[]} me="ana" names={NAMES} />),
      streak: html(<StreakStrip rows={rows} me="ana" names={NAMES} />),
      addSnap: html(<AddSnap />),
    })
  })
})
