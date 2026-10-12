import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreakStrip } from './streak-strip.js'
import type { SnapRow } from '../format.js'
import { clientConfig, configure } from './config.js'
import {
  CHICAGO_TODAY, COUPLE_ZONE, EASTERN, EASTERN_TODAY, NOW as LATE_NOW, lateEveningTimes,
} from '../../test/support/late-evening-couple.js'
import { zoned } from '../zoned.js'

const NAMES = { ana: 'Ana', ben: 'Ben' }
const at = (d: number) => new Date(2026, 8, d, 12).toISOString()
const row = (by: 'ana' | 'ben', d: number): SnapRow => ({
  id: `${by}${d}`, by, caption: '', kind: 'photo', thumbUrl: null, durationSec: null, createdAt: at(d), witnessedAt: null, hidden: false,
})

describe('StreakStrip', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 27, 18)) })
  afterEach(() => vi.useRealTimers())

  it('shows your streak, theirs, and the together streak', () => {
    render(<StreakStrip rows={[row('ana', 27), row('ana', 26), row('ben', 26), row('ben', 25)]} me="ana" names={NAMES} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['🔥2You', '🔥2Ben', '🔥1Together'])
    expect(screen.getByText('You shared today. Waiting on Ben.')).toBeInTheDocument()
  })
  it('tells you what today is worth when you have not shared yet', () => {
    render(<StreakStrip rows={[row('ben', 26), row('ben', 25)]} me="ben" names={NAMES} />)
    expect(screen.getByText('Share a snap today to keep your 2-day streak.')).toBeInTheDocument()
  })
  it('invites a first streak when there is none', () => {
    render(<StreakStrip rows={[]} me="ben" names={NAMES} />)
    expect(screen.getByText('Share a snap today to start a streak.')).toBeInTheDocument()
  })
})

describe('StreakStrip, household', () => {
  const household = (fn: () => void) => {
    const before = clientConfig()
    configure({ ...before, features: { streak: { kind: 'household', timeZone: 'America/Los_Angeles', since: '2026-09-01', freeSkipsPerWeek: 1 } } })
    try {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T20:00:00Z'))
      fn()
    } finally { vi.useRealTimers(); configure(before) }
  }
  const hrow = (createdAt: string): SnapRow => ({ id: createdAt, by: 'ana', caption: '', kind: 'photo', thumbUrl: null, durationSec: null, createdAt, witnessedAt: null, hidden: false })
  it('shows one count for everyone who shares, and the free skip', () => household(() => {
    render(<StreakStrip me="ana" names={{ ana: 'Ana', ben: 'Ben' }} rows={[hrow('2026-10-01T18:00:00Z'), hrow('2026-09-29T18:00:00Z')]} />)
    // Shared on the 1st and on the 29th: the 30th is that week's free skip, so the count is 2.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/One free skip used this week/)).toBeInTheDocument()
    expect(screen.queryByText('Together')).toBeNull()
  }))
  it('a person who only witnesses is shown no streak at all, not even the count', () => household(() => {
    const { container } = render(<StreakStrip me="cy" names={{ ana: 'Ana', cy: 'Cy' }} shares={false} rows={[hrow('2026-10-01T18:00:00Z')]} />)
    expect(container).toBeEmptyDOMElement()
  }))
})

// The screenshot that started this: fifteen days running read as 15 / 1 / 0 because the phone
// counted in its own zone. The suite runs with TZ=UTC, which for these rows reads the same way an
// eastern phone does, so the strip given no zone IS the bug and the strip given the couple's zone
// is the fix. Both are asserted, because a zone test that would pass with the prop ignored proves
// nothing.
describe('StreakStrip, counted in the zone the couple keeps', () => {
  const rows = (): SnapRow[] => lateEveningTimes().map(({ by, createdAt }) => ({
    id: createdAt + by, by, caption: '', kind: 'photo', thumbUrl: null, durationSec: null,
    createdAt, witnessedAt: null, hidden: false,
  }))
  const pills = () => screen.getAllByRole('listitem').map((li) => li.textContent)

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(LATE_NOW) })
  afterEach(() => vi.useRealTimers())

  it('is rendered at an instant where the two zones disagree about the day, or it proves nothing', () => {
    expect(zoned(LATE_NOW, COUPLE_ZONE).dayKey).toBe(CHICAGO_TODAY)
    expect(zoned(LATE_NOW, EASTERN).dayKey).toBe(EASTERN_TODAY)
    expect(zoned(LATE_NOW, COUPLE_ZONE).dayKey).not.toBe(zoned(LATE_NOW, EASTERN).dayKey)
  })

  it('shows fifteen, fifteen and fifteen when it is given the couple\'s zone', () => {
    render(<StreakStrip rows={rows()} me="ana" names={NAMES} timeZone={COUPLE_ZONE} />)
    expect(pills()).toEqual(['🔥15You', '🔥15Ben', '🔥15Together'])
    expect(screen.getByText('You shared today. Ben did too.')).toBeInTheDocument()
  })

  it('reads a day in every zone in play when each of them keeps their own', () => {
    render(<StreakStrip rows={rows()} me="ana" names={NAMES} timeZone={{ ana: COUPLE_ZONE, ben: EASTERN }} />)
    expect(pills()).toEqual(['🔥15You', '🔥15Ben', '🔥15Together'])
  })

  it('is the bug with no zone: the phone\'s own day collapses his streak and theirs', () => {
    render(<StreakStrip rows={rows()} me="ana" names={NAMES} />)
    expect(pills()).toEqual(['🔥15You', '🔥1Ben', '0Together'])
  })
})
