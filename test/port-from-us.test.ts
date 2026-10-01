// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

// A throwaway "Us" repository with one committed file, and a manifest that ports it.
function port(source: string, file: Record<string, unknown> = {}, { extraFiles = [], ...over }: Record<string, unknown> & { extraFiles?: Record<string, unknown>[] } = {}) {
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
    ...over,
    maps: { client: { '@/lib/us/types': '../types.js', '../theme': './theme.js' } },
    renames: { NOTE_MAX: 'MESSAGE_MAX' },
    urls: [['`/api/us/snaps', '`${clientConfig().apiBase}']],
    configImport: "import { clientConfig } from './config.js'",
    files: [{ from: 'src/a.tsx', to: join(out, 'a.tsx'), map: 'client', ...file }, ...extraFiles],
  }))
  execFileSync('node', [join(ROOT, 'scripts/port-from-us.mjs'), manifest], { env: { ...process.env, US_REPO: us, PORT_ROOT: out } })
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

    it('counts a spread as a use of an import', () => {
      const out = port(["import { BASE } from './base'", '', 'export const KEEP = { ...BASE, x: 1 }', ''].join('\n'), { only: ['KEEP'] })
      expect(out).toContain("import { BASE } from './base.js'")
    })

    it('keeps default and namespace imports that are used, drops those that are not', () => {
      const out = port(
        ["import Def from './def'", "import * as NS from './ns'", "import Mixed, { m } from './mixed'", "import Unused from './unused'", '',
          'export const KEEP = [Def, NS.a, Mixed, m]', ''].join('\n'),
        { only: ['KEEP'] },
      )
      expect(out).toContain("import Def from './def.js'")
      expect(out).toContain("import * as NS from './ns.js'")
      expect(out).toContain("import Mixed, { m } from './mixed.js'")
      expect(out).not.toContain('unused')
    })

    it('keeps every signature of an overloaded function', () => {
      const out = port(
        ['export function f(a: string): string', 'export function f(a: number): number', 'export function f(a: unknown) {', '  return a', '}', ''].join('\n'),
        { only: ['f'] },
      )
      expect(out.match(/export function f/g)).toHaveLength(3)
    })

    it('throws, naming the identifier, on an import shape it cannot classify', () => {
      expect(() => port(["import './side-effect'", 'export const KEEP = 1', ''].join('\n'), { only: ['KEEP'] })).toThrow()
      expect(() => port(['export { KEEP2 }', 'export const KEEP = 1', ''].join('\n'), { only: ['KEEP'] })).toThrow()
    })
  })

  it('refuses a destination outside the repository', () => {
    expect(() => port('const a = 1', { to: '/tmp/escaped-from-repo.ts' })).toThrow(/outside/)
  })

  it('leaves a file the manifest marks diverged untouched, so a re-port cannot undo work done since', () => {
    const out = mkdtempSync(join(tmpdir(), 'dv-'))
    const kept = join(out, 'kept.tsx')
    writeFileSync(kept, 'changed here since\n')
    const ported = port('const a = 1\n', {}, { diverged: [kept], extraFiles: [{ from: 'src/a.tsx', to: kept, map: 'client' }] })
    expect(ported).toBe('const a = 1\n')
    expect(readFileSync(kept, 'utf8')).toBe('changed here since\n')
  })

  it('refuses a diverged entry that names no file in the manifest, so the list cannot go stale', () => {
    expect(() => port('const a = 1\n', {}, { diverged: ['src/not-ported.ts'] })).toThrow(/diverged/)
  })

  it('refuses a commit that is not a hex sha, before running git', () => {
    expect(() => port('const a = 1', {}, { commit: '--upload-pack=x' })).toThrow(/hex/)
  })
})

describe('port-from-us replace', () => {
  it('applies literal per-file edits after the imports are rewritten', () => {
    const out = port("import { INK } from '../theme'\n// she said hi\n", { replace: [['she said hi', 'they said hi']] })
    expect(out).toContain('// they said hi')
    expect(out).toContain("from './theme.js'")
  })

  it('takes a re: rule as a regular expression', () => {
    expect(port('// in Xyz cannot\n', { replace: [['re:in [A-Z][a-z]+ cannot', 'cannot']] })).toContain('// cannot')
    expect(() => port('a\n', { replace: [['re:z+', 'x']] })).toThrow(/matches nothing/)
  })

  it('refuses a rule that matches nothing, naming the file', () => {
    expect(() => port('const a = 1\n', { replace: [['not there', 'x']] })).toThrow(/src\/a\.tsx: replace rule matches nothing/)
  })
})

// Needs the source checkout at the pinned commit, which CI does not have: it runs wherever the
// source app is on disk (US_REPO overrides the default location) and is skipped elsewhere.
const SOURCE = process.env.US_REPO ?? join(process.env.HOME ?? '', 'Documents/github-repos/us-app')
const MANIFESTS = ['task13', 'task14', 'task15']
const pinOf = (name: string) => (JSON.parse(readFileSync(join(ROOT, `scripts/port/${name}.json`), 'utf8')) as { commit: string }).commit
const haveSource = (name: string) => {
  try { execFileSync('git', ['-C', SOURCE, 'cat-file', '-e', `${pinOf(name)}^{commit}`], { stdio: 'ignore' }); return true } catch { return false }
}

describe.each(MANIFESTS)('the %s port', (name) => {
  it.skipIf(!haveSource(name))('reproduces the committed files byte for byte, so the scrub survives a re-port', () => {
    const out = mkdtempSync(join(tmpdir(), 'rp-'))
    const manifest = JSON.parse(readFileSync(join(ROOT, `scripts/port/${name}.json`), 'utf8')) as { files: { to: string }[]; diverged?: string[] }
    execFileSync('node', [join(ROOT, 'scripts/port-from-us.mjs'), join(ROOT, `scripts/port/${name}.json`)], {
      env: { ...process.env, PORT_ROOT: out }, stdio: 'pipe',
    })
    // A diverged file was changed here on purpose; the port leaves it unwritten and it is not compared.
    for (const f of manifest.files.filter((x) => !(manifest.diverged ?? []).includes(x.to))) {
      expect(readFileSync(join(out, f.to), 'utf8'), f.to).toBe(readFileSync(join(ROOT, f.to), 'utf8'))
    }
  })
})

describe('the port manifests', () => {
  it('mark as diverged only files they port', () => {
    const dir = join(ROOT, 'scripts/port')
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { files: { to: string }[]; diverged?: string[] }
      for (const d of m.diverged ?? []) expect(m.files.map((f) => f.to), `${name} ${d}`).toContain(d)
    }
  })

  it('carry no dated or quoted text in a literal replace rule, because a rule is committed as plainly as the file it fixes', () => {
    const dir = join(ROOT, 'scripts/port')
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { files: { from: string; replace?: [string, string][] }[] }
      for (const f of m.files) {
        for (const [from] of f.replace ?? []) {
          if (from.startsWith('re:')) continue
          expect(from, `${name} ${f.from}`).not.toMatch(/\d{4}-\d\d-\d\d/)
          expect(from, `${name} ${f.from}`).not.toMatch(/"[^"]*\s[^"]*"/)
        }
      }
    }
  })
})
