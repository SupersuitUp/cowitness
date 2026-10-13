import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as camera from './camera.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// Every module the camera entry reaches, by following its relative imports through the sources.
function reach(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]!
      if (!spec.startsWith('.')) { bare.add(spec); continue }
      const base = join(dirname(file), spec.replace(/\.js$/, ''))
      visit([`${base}.ts`, `${base}.tsx`].find((p) => { try { readFileSync(p); return true } catch { return false } })!)
    }
  }
  visit(entry)
  return { files, bare }
}

describe('the camera entry', () => {
  it('hands an app the capture layer and the two things its opening tap must call', () => {
    expect(typeof camera.SnapCamera).toBe('function')
    expect(typeof camera.openStream).toBe('function')
    expect(typeof camera.askForMotion).toBe('function')
  })

  // The Helm is a Vite app with no Next.js in it. `/client` reaches next/navigation through AddSnap,
  // so an app that is not a Next.js app can take the camera only from an entry that never does.
  it('reaches nothing but React, so an app without Next.js can import it', () => {
    expect([...reach(join(HERE, 'camera.ts')).bare]).toEqual(['react'])
  })

  it('is a published entry point of the package', () => {
    const pkg = JSON.parse(readFileSync(join(HERE, '../../package.json'), 'utf8'))
    expect(pkg.exports['./camera']).toEqual({ types: './dist/client/camera.d.ts', import: './dist/client/camera.js' })
  })
})
