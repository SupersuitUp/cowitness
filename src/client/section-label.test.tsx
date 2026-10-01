// The grey capitals over a group were typed out ten times; now they are <SectionLabel>. This fails
// if the class string is typed out again anywhere but section-label.tsx.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { SectionLabel, SECTION_LABEL } from './section-label.js'
import { MUTED } from './theme.js'

const APP = join(__dirname, '..')
const files = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.|\.dev\.tsx$/.test(n) ? [p] : []
})

describe('one section label', () => {
  it('its classes are written once', () => {
    const copies = files(APP).filter((p) => readFileSync(p, 'utf8').includes(SECTION_LABEL)).map((p) => p.slice(APP.length + 1))
    expect(copies).toEqual(['client/section-label.tsx'])
  })
  it('renders the element asked for, in grey capitals, with extra spacing kept', () => {
    render(<SectionLabel as="h3" className="mt-3">Live links</SectionLabel>)
    const el = screen.getByRole('heading', { level: 3, name: 'Live links' })
    expect(el.className).toBe(`mt-3 ${SECTION_LABEL}`)
    expect(el).toHaveStyle({ color: MUTED })
  })
})
