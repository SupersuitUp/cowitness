import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

// What 0.1.3 did with every option off: recorded ONCE, from 0.1.3's own code, with GOLDEN_RECORD=1,
// and only ever compared against afterwards. Re-recording from changed code would make the proof
// prove nothing, so a file that exists is never overwritten.
export const RECORDING = process.env['GOLDEN_RECORD'] === '1'
const DIR = join(__dirname, 'files')

// Key order is not observable (Firestore and JSON clients ignore it); array order is, and is kept.
export function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon)
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]))
  }
  return x
}

export function golden(name: string, value: unknown): void {
  const file = join(DIR, `${name}.json`)
  const text = `${JSON.stringify(canon(value), null, 2)}\n`
  if (RECORDING) {
    if (existsSync(file)) throw new Error(`${name}.json is already recorded. The options-off golden is recorded once, from 0.1.3, and never again.`)
    mkdirSync(DIR, { recursive: true })
    writeFileSync(file, text)
    return
  }
  if (!existsSync(file)) throw new Error(`${name}.json is missing: record it from 0.1.3 with GOLDEN_RECORD=1`)
  expect(text).toBe(readFileSync(file, 'utf8'))
}
