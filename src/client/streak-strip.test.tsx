import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreakStrip } from './streak-strip.js'
import type { SnapRow } from '../format.js'

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
