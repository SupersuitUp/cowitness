#!/usr/bin/env node
// Copies files out of the source app at ONE pinned commit into this repository, rewriting their
// imports to this package's layout. Read-only against the source: it only runs `git show`, so a
// later commit there can never change what was moved. scripts/port/task*.json are the record of
// every file that moved, from where, to where, and through which import map.
//
//   node scripts/port-from-us.mjs <manifest.json>      (US_REPO overrides the source checkout)
//
// A file entry may carry "only": [names]. The output is then just those top-level declarations,
// verbatim, plus the import lines filtered to the names they use, so a reference copy is produced
// from the pinned source and never trimmed by hand.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const US = process.env.US_REPO ?? join(process.env.HOME ?? '', 'Documents/github-repos/us-app')
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const rewrite = (spec, map) => {
  if (Object.hasOwn(map, spec)) return map[spec]
  if (spec.startsWith('.') && !/\.(js|json|css)$/.test(spec)) return `${spec}.js`
  return spec
}

const DECL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/

// Splits a source into its import statements and its top-level declarations (each with the
// comment lines directly above it). A top-level line is one at column 0.
function blocks(text) {
  const lines = text.split('\n')
  const imports = []
  const decls = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^import\s/.test(line)) {
      let j = i
      while (!/from\s+['"][^'"]+['"]\s*;?\s*$/.test(lines[j]) && !/^import\s+['"]/.test(lines[j]) && j < lines.length - 1) j++
      imports.push(lines.slice(i, j + 1).join('\n'))
      i = j + 1
      continue
    }
    const m = DECL.exec(line)
    if (m) {
      let start = i
      while (start > 0 && /^(\/\/|\/\*|\s\*)/.test(lines[start - 1])) start--
      let j = i + 1
      while (j < lines.length && (lines[j] === '' || /^[\s}\])]/.test(lines[j]) || /^\s*$/.test(lines[j]))) j++
      // trim trailing blank lines
      let end = j
      while (end > i + 1 && lines[end - 1].trim() === '') end--
      decls.push({ name: m[1], text: lines.slice(start, end).join('\n') })
      i = j
      continue
    }
    i++
  }
  return { imports, decls }
}

// Keeps the named declarations and only the imported names they use.
function only(text, names) {
  const { imports, decls } = blocks(text)
  const kept = names.map((n) => {
    const d = decls.find((x) => x.name === n)
    if (!d) throw new Error(`no top-level declaration named ${n}`)
    return d.text
  })
  const body = kept.join('\n\n')
  const uses = (id) => new RegExp(`(?<![\\w$.])${id.replace(/\$/g, '\\$')}(?![\\w$])`).test(body)
  const outImports = []
  for (const imp of imports) {
    const m = /^import\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"][^'"]+['"])/s.exec(imp)
    if (!m) continue
    const specs = m[2].split(',').map((s) => s.trim()).filter(Boolean)
    const used = specs.filter((s) => uses(s.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim()))
    if (used.length) outImports.push(`import ${m[1] ?? ''}{ ${used.join(', ')} } from ${m[3]}`)
  }
  return `${outImports.join('\n')}${outImports.length ? '\n\n' : ''}${body}\n`
}

for (const f of manifest.files) {
  const map = manifest.maps[f.map]
  if (!map) throw new Error(`no map named ${f.map}`)
  let text = execFileSync('git', ['-C', US, 'show', `${manifest.commit}:${f.from}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (f.only) text = only(text, f.only)
  text = text.replace(/(from\s+|import\(\s*|vi\.mock\(\s*)(['"])([^'"]+)\2/g, (_all, lead, q, spec) => `${lead}${q}${rewrite(spec, map)}${q}`)
  if (f.renames) {
    for (const [a, b] of Object.entries(manifest.renames ?? {})) text = text.replace(new RegExp(`\\b${a}\\b`, 'g'), b)
  }
  if (f.urls) {
    let hit = false
    for (const [a, b] of manifest.urls ?? []) if (text.includes(a)) { text = text.split(a).join(b); hit = true }
    if (hit) {
      const lines = text.split('\n')
      lines.splice(/^['"]use client['"]/.test(lines[0]) ? 1 : 0, 0, manifest.configImport)
      text = lines.join('\n')
    }
  }
  mkdirSync(dirname(f.to), { recursive: true })
  writeFileSync(f.to, text)
  console.log(`${f.from} -> ${f.to}`)
}
