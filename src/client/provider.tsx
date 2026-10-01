'use client'

import type { ReactNode } from 'react'
import { configure, type CowitnessClientConfig } from './config.js'
import { setTheme, type ThemeTokens } from './theme.js'

// Configures Cowitness before anything under it draws: where its handlers and pages are, the
// app's upload tickets, the vault's name, how the app draws a conversation, and the app's look.
// `config.renderThread` is a function, so an app renders this from one of its own client
// components, never straight from a server component.
export function CowitnessProvider({ config, theme, children }: { config: CowitnessClientConfig; theme?: Partial<ThemeTokens>; children: ReactNode }) {
  configure(config)
  if (theme) setTheme(theme)
  return <>{children}</>
}
