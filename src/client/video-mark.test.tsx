import { noPosterBg } from './video-mark'
import { setTheme, DEFAULT_THEME } from './theme'

// The no-poster tile is ink at 90%. It must hold for an app whose ink is a CSS
// variable (a theme that follows the phone's light and dark), where appending hex alpha digits to
// "var(--ink)" made an invalid colour and the tile drew no background at all.
afterEach(() => setTheme(DEFAULT_THEME))

it('is the ink at 90% for a hex ink, in the hex-alpha form 0.1.3 drew', () => {
  setTheme({ ink: '#1a1a1a' })
  expect(noPosterBg()).toBe('#1a1a1ae6')
})

it('is still a valid colour when the ink is a CSS variable', () => {
  setTheme({ ink: 'var(--ink)' })
  expect(noPosterBg()).toBe('color-mix(in srgb, var(--ink) 90%, transparent)')
  expect(noPosterBg()).not.toMatch(/\)e6$/)
})
