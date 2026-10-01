import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CowitnessProvider } from './provider.js'
import { SnapsArchive } from './snaps-archive.js'
import { clientConfig, configure } from './config.js'
import { DEFAULT_THEME, INK, setTheme } from './theme.js'
import type { SnapRow } from '../format.js'

const kept = clientConfig()
const NAMES = { ana: 'Ana', ben: 'Ben' }
const row: SnapRow = {
  id: 's1', by: 'ben', caption: 'lunch', kind: 'photo', thumbUrl: 'https://img/t', durationSec: null,
  createdAt: new Date().toISOString(), witnessedAt: null, hidden: false,
}

describe('CowitnessProvider', () => {
  afterEach(() => { configure(kept); setTheme(DEFAULT_THEME) })

  it('configures Cowitness and its look before anything under it draws', () => {
    render(<CowitnessProvider config={{ ...kept, pageBase: '/moments' }} theme={{ ink: '#202020' }}><p>inside</p></CowitnessProvider>)
    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(clientConfig().pageBase).toBe('/moments')
    expect(INK).toBe('#202020')
  })

  it('links every snap to wherever the app keeps its pages', () => {
    render(<CowitnessProvider config={{ ...kept, pageBase: '/moments' }}><SnapsArchive rows={[row]} me="ana" names={NAMES} /></CowitnessProvider>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/moments/s1')
  })
})
