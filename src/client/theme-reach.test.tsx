import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { AddSnap } from './add-snap.js'
import { WitnessSession } from './witness-session.js'
import { DEFAULT_THEME, setTheme } from './theme.js'
import type { SnapView } from '../types.js'

const snap: SnapView = {
  id: 'a', by: 'ben', caption: 'c', kind: 'photo', takenAt: '2026-09-27T14:03:00', width: 3, height: 4,
  paths: { original: 'o', display: 'd', thumb: 't' }, witnessedAt: null, hiddenAt: null,
  createdAt: '2026-09-27T19:00:00.000Z', thumbUrl: 'https://img/t', displayUrl: 'https://img/d',
}

// A host's theme must colour every element Cowitness draws, not just the ones that read a token
// when they were first written: no class name in these screens may assume a host's stylesheet.
describe('the host theme reaches the elements that used to need a host class', () => {
  afterEach(() => { setTheme(DEFAULT_THEME); vi.unstubAllGlobals() })

  it('the failed-save note is written in the theme\'s soft accent', async () => {
    setTheme({ accentSoft: '#010203' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(<WitnessSession queue={[snap, { ...snap, id: 'b' }]} me="ana" names={{ ana: 'Ana', ben: 'Ben' }} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    expect(screen.getByText('Not saved. Try again.')).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  })

  it('the caption field hands the theme\'s placeholder colour to its hint text', () => {
    setTheme({ placeholder: '#040506' })
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    render(<AddSnap />)
    fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })
    const field = screen.getByLabelText('Caption')
    expect(field.style.getPropertyValue('--cowitness-placeholder')).toBe('#040506')
    expect(field.className).toContain('var(--cowitness-placeholder)')
  })
})
