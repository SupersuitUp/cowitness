// The look Cowitness draws with, handed in by the app. Live bindings: a component reads INK when
// it renders, and the canvas that composes a double-camera snap reads BG when it draws, so
// setTheme() before the first render is all an app does. The names are the constants the screens
// were written against in the app they came from, so the moved code is unchanged.
export interface ThemeTokens {
  serif: string; bg: string
  /** Must be #rrggbb: a video with no poster is drawn in ink at 90% (an alpha suffix). */
  ink: string
  muted: string; hairline: string; onInk: string
  accent: string; accentTint: string; danger: string
  /** The softer accent a failed-save note is written in. */
  accentSoft: string
  /** The colour of the hint text inside an empty field. */
  placeholder: string
}

export const DEFAULT_THEME: ThemeTokens = {
  serif: 'Georgia, serif', bg: '#ffffff', ink: '#1a1a1a', muted: '#767676', hairline: '#ececec', onInk: '#ffffff',
  accent: '#d94c63', accentTint: '#fbe9ec', danger: '#a33a3a', accentSoft: '#f3a3a3', placeholder: '#b5aba2',
}

export let SERIF = DEFAULT_THEME.serif
export let BG = DEFAULT_THEME.bg
export let INK = DEFAULT_THEME.ink
export let MUTED = DEFAULT_THEME.muted
export let HAIRLINE = DEFAULT_THEME.hairline
export let ON_INK = DEFAULT_THEME.onInk
export let ACCENT = DEFAULT_THEME.accent
export let ACCENT_TINT = DEFAULT_THEME.accentTint
export let DANGER = DEFAULT_THEME.danger
export let ACCENT_SOFT = DEFAULT_THEME.accentSoft
export let PLACEHOLDER = DEFAULT_THEME.placeholder

export function setTheme(t: Partial<ThemeTokens>): void {
  if (t.serif !== undefined) SERIF = t.serif
  if (t.bg !== undefined) BG = t.bg
  if (t.ink !== undefined) INK = t.ink
  if (t.muted !== undefined) MUTED = t.muted
  if (t.hairline !== undefined) HAIRLINE = t.hairline
  if (t.onInk !== undefined) ON_INK = t.onInk
  if (t.accent !== undefined) ACCENT = t.accent
  if (t.accentTint !== undefined) ACCENT_TINT = t.accentTint
  if (t.danger !== undefined) DANGER = t.danger
  if (t.accentSoft !== undefined) ACCENT_SOFT = t.accentSoft
  if (t.placeholder !== undefined) PLACEHOLDER = t.placeholder
}
