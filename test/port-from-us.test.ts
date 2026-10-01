// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

// A throwaway "Us" repository with one committed file, and a manifest that ports it.
function port(source: string, file: Record<string, unknown> = {}) {
  const us = mkdtempSync(join(tmpdir(), 'us-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: us, encoding: 'utf8' }).trim()
  git('init', '-q')
  mkdirSync(join(us, 'src'))
  writeFileSync(join(us, 'src/a.tsx'), source)
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x')
  const commit = git('rev-parse', 'HEAD')
  const out = mkdtempSync(join(tmpdir(), 'out-'))
  const manifest = join(out, 'm.json')
  writeFileSync(manifest, JSON.stringify({
    commit,
    maps: { client: { '@/lib/us/types': '../types.js', '../theme': './theme.js' } },
    renames: { NOTE_MAX: 'MESSAGE_MAX' },
    urls: [['`/api/us/snaps', '`${clientConfig().apiBase}']],
    configImport: "import { clientConfig } from './config.js'",
    files: [{ from: 'src/a.tsx', to: join(out, 'a.tsx'), map: 'client', ...file }],
  }))
  execFileSync('node', [join(ROOT, 'scripts/port-from-us.mjs'), manifest], { env: { ...process.env, US_REPO: us } })
  return readFileSync(join(out, 'a.tsx'), 'utf8')
}

describe('port-from-us', () => {
  it('rewrites mapped specifiers, adds .js to the rest, and leaves packages alone', () => {
    const out = port([
      "import type { Snap } from '@/lib/us/types'",
      "import { INK } from '../theme'",
      "import { x } from './snap-frames'",
      "import { useState } from 'react'",
      "vi.mock('./recording-vault', async (orig) => ({ ...(await orig<typeof import('./recording-vault')>()) }))",
    ].join('\n'))
    expect(out).toContain("from '../types.js'")
    expect(out).toContain("from './theme.js'")
    expect(out).toContain("from './snap-frames.js'")
    expect(out).toContain("from 'react'")
    expect(out).toContain("vi.mock('./recording-vault.js'")
    expect(out).toContain("import('./recording-vault.js')")
  })

  it('renames whole identifiers only when asked', () => {
    expect(port('const a = NOTE_MAX + NOTE_MAXIMUM', { renames: true })).toBe('const a = MESSAGE_MAX + NOTE_MAXIMUM')
    expect(port('const a = NOTE_MAX')).toBe('const a = NOTE_MAX')
  })

  it('replaces the app addresses and imports the config after use client', () => {
    const out = port("'use client'\nconst u = `/api/us/snaps/${id}`", { urls: true })
    expect(out.split('\n')).toEqual(["'use client'", "import { clientConfig } from './config.js'", 'const u = `${clientConfig().apiBase}/${id}`'])
  })

  describe('only', () => {
    const source = [
      "import { A, B } from './a'",
      "import type { T, U } from '@/lib/us/types'",
      "import { unused } from './unused'",
      '',
      '// kept: a note above it',
      'export const KEEP = A + 1',
      '',
      'export const DROP = unused()',
      '',
      'export function keepFn(x: T): number {',
      '  const y = B(x)',
      '',
      '  return y',
      '}',
      '',
      'export type Gone = U',
      '',
      'export type Shape =',
      "  | 'one'",
      "  | 'two'",
      '',
    ].join('\n')

    it('keeps only the named declarations, with their comments and only the imports they use', () => {
      const out = port(source, { only: ['KEEP', 'keepFn', 'Shape'] })
      expect(out).toBe([
        "import { A, B } from './a.js'",
        "import type { T } from '../types.js'",
        '',
        '// kept: a note above it',
        'export const KEEP = A + 1',
        '',
        'export function keepFn(x: T): number {',
        '  const y = B(x)',
        '',
        '  return y',
        '}',
        '',
        'export type Shape =',
        "  | 'one'",
        "  | 'two'",
        '',
      ].join('\n'))
      expect(out).not.toContain('DROP')
      expect(out).not.toContain('unused')
      expect(out).not.toContain('Gone')
    })

    it('refuses a name the source does not declare', () => {
      expect(() => port(source, { only: ['Missing'] })).toThrow()
    })
  })
})
