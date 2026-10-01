import { afterEach, describe, expect, it } from 'vitest'
import { clientConfig, configure, type CowitnessClientConfig } from './config.js'
import { BG, DEFAULT_THEME, INK, setTheme } from './theme.js'
import { otherIn } from './people.js'

describe('the client configuration', () => {
  const kept = clientConfig()
  afterEach(() => { configure(kept); setTheme(DEFAULT_THEME) })

  it('is what the app last configured', () => {
    const c: CowitnessClientConfig = { ...kept, apiBase: '/api/snaps', pageBase: '/moments' }
    configure(c)
    expect(clientConfig()).toBe(c)
  })

  it('hands every screen the look the app set, read at render time', () => {
    setTheme({ ink: '#101010', bg: '#fafafa' })
    expect(INK).toBe('#101010')
    expect(BG).toBe('#fafafa')
    setTheme(DEFAULT_THEME)
    expect(INK).toBe(DEFAULT_THEME.ink)
  })

  it('names the other person from the names the screen was given', () => {
    expect(otherIn({ ana: 'Ana', ben: 'Ben' }, 'ana')).toBe('ben')
    expect(otherIn({ ana: 'Ana', ben: 'Ben' }, 'ben')).toBe('ana')
  })
})
