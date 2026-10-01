import { describe, expect, it } from 'vitest'
import { spokenLanguage } from './language.js'

describe('the spoken language a request asked for', () => {
  it("is one the app listens for, or 'auto'", () => {
    const langs = ['en', 'fr', 'de']
    expect(spokenLanguage('fr', langs)).toBe('fr')
    expect(spokenLanguage('auto', langs)).toBe('auto')
    expect(spokenLanguage('ja', langs)).toBe('auto')
    expect(spokenLanguage(undefined, langs)).toBe('auto')
    expect(spokenLanguage(3, langs)).toBe('auto')
  })
})
