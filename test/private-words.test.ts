// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

// A throwaway repository holding only the check, one forbidden fingerprint, and one file.
function repoWith(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'private-words-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'tailor'))
  for (const f of ['private-words.mjs', 'git.mjs']) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f))
  execFileSync('node', ['scripts/private-words.mjs', '--add', 'zebracorn'], { cwd: dir })
  writeFileSync(join(dir, 'a.ts'), content)
  return dir
}
const check = (cwd: string) => spawnSync('node', ['scripts/private-words.mjs'], { cwd, encoding: 'utf8' })

describe('the private-words check', () => {
  it('refuses a forbidden word outside tailor/, and never prints the word', () => {
    const r = check(repoWith('// hello Zebracorn\n'))
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('private word at a.ts:1')
    expect(r.stdout + r.stderr).not.toMatch(/zebracorn/i)
  })

  it('passes a file without it', () => {
    expect(check(repoWith('// hello world\n')).status).toBe(0)
  })

  it('passes this repository', () => {
    const r = check(ROOT)
    expect(r.stdout + r.stderr).toContain('no private words outside tailor/')
    expect(r.status).toBe(0)
  })
})
