import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// The real Link keeps `prefetch` to itself; this one puts it on the anchor so a test can read it.
vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: boolean | null; children: ReactNode }) =>
    <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>,
}))
import { render, screen, within } from '@testing-library/react'
import { SnapsArchive } from './snaps-archive.js'
import type { SnapRow } from '../format.js'

const NAMES = { ana: 'Ana', ben: 'Ben' }
const today = new Date()
const row = (o: Partial<SnapRow> = {}): SnapRow => ({
  id: 's1', by: 'ben', caption: 'lunch', kind: 'photo', thumbUrl: 'https://img/t1', durationSec: null,
  createdAt: today.toISOString(), witnessedAt: null, hidden: false, ...o,
})

describe('SnapsArchive', () => {
  it('shows every snap as a link, grouped under its day, with who shared it', () => {
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    render(<SnapsArchive me="ana" names={NAMES} rows={[row(), row({ id: 's2', by: 'ana', createdAt: yesterday.toISOString(), caption: '' })]} />)
    const today_ = screen.getByRole('region', { name: 'Today' })
    expect(within(today_).getByRole('link')).toHaveAttribute('href', '/cowitness/s1')
    expect(within(today_).getByText('Ben')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Yesterday' })).getByRole('link')).toHaveAttribute('href', '/cowitness/s2')
  })

  it('does not prefetch every tile\'s page in the background', () => {
    render(<SnapsArchive me="ana" names={NAMES} rows={[row(), row({ id: 's2' })]} />)
    for (const l of screen.getAllByRole('link')) expect(l).toHaveAttribute('data-prefetch', 'false')
  })

  it('says what it was told to when empty', () => {
    render(<SnapsArchive me="ana" names={NAMES} rows={[]} empty="All caught up." />)
    expect(screen.getByText('All caught up.')).toBeInTheDocument()
  })

  it('says so when there is nothing yet', () => {
    render(<SnapsArchive me="ana" names={NAMES} rows={[]} />)
    expect(screen.getByText('Nothing shared yet. Add a snap from your day.')).toBeInTheDocument()
  })

  it('marks a hidden snap for the member who hid it', () => {
    render(<SnapsArchive me="ben" names={NAMES} rows={[row({ hidden: true })]} />)
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('my own snap says when it has been witnessed', () => {
    render(<SnapsArchive me="ana" names={NAMES} rows={[row({ by: 'ana', witnessedAt: '2026-09-27T21:00:00.000Z' }), row({ id: 's2', by: 'ana' })]} />)
    expect(screen.getAllByText('Witnessed')).toHaveLength(1)
  })
})

describe('SnapsArchive with options', () => {
  it('draws a voice snap as its first words, marks "just us", and names a tag', () => {
    render(<SnapsArchive me="ana" names={{ ana: 'Ana', ben: 'Ben' }} tagLabels={{ 't-first': 'First' }} rows={[
      { id: 'v1', by: 'ana', caption: '', kind: 'voice', thumbUrl: null, durationSec: 9, createdAt: '2026-09-30T09:00:00.000Z', witnessedAt: null, hidden: false, words: 'tavo merin solut', justUs: true, tags: ['t-first'] },
    ]} />)
    expect(screen.getByText('tavo merin solut')).toBeInTheDocument()
    expect(screen.getByLabelText('Just us')).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
  })
  it('a voice snap whose words have not come yet says it is a voice note', () => {
    render(<SnapsArchive me="ana" names={NAMES} rows={[row({ kind: 'voice', thumbUrl: null, words: '' })]} />)
    expect(screen.getByText('Voice note')).toBeInTheDocument()
  })
  it('an old row, and tags with no labels given, draw nothing new', () => {
    const { container } = render(<SnapsArchive me="ana" names={NAMES} rows={[row({ tags: ['t-first'] })]} />)
    expect(screen.queryByText('t-first')).toBeNull()
    expect(screen.queryByLabelText('Just us')).toBeNull()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})
