#!/usr/bin/env node
// Copies files out of the source app at ONE pinned commit into this repository, rewriting their
// imports to this package's layout. Read-only against the source: it only runs `git show`, so a
// later commit there can never change what was moved. scripts/port/task*.json are the record of
// every file that moved, from where, to where, and through which import map.
//
//   node scripts/port-from-us.mjs <manifest.json>      (US_REPO overrides the source checkout)
//
// A file entry may carry "replace": [[from, to], ...], literal edits applied after the imports are
// rewritten (a "re:" prefix on the first item makes it a regular expression).
//
// A file entry may carry "only": [names]. The output is then just those top-level declarations,
// verbatim, plus the import lines filtered to the names they use, so a reference copy is produced
// from the pinned source and never trimmed by hand.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const US = process.env.US_REPO ?? join(process.env.HOME ?? '', 'Documents/github-repos/us-app')
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const rewrite = (spec, map) => {
  if (Object.hasOwn(map, spec)) return map[spec]
  if (spec.startsWith('.') && !/\.(js|json|css)$/.test(spec)) return `${spec}.js`
  return spec
}

const DECL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/

// Splits a source into its import statements and its top-level declarations (each with the
// comment lines directly above it). A top-level line is one at column 0. Anything at column 0
// that is none of: import, declaration, comment, blank, directive, is a shape this script cannot
// classify, and it throws rather than drop it.
function blocks(text, file) {
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
      while (j < lines.length && /^(\s|[}\])]|$)/.test(lines[j])) j++
      let end = j
      while (end > i + 1 && lines[end - 1].trim() === '') end--
      decls.push({ name: m[1], text: lines.slice(start, end).join('\n') })
      i = j
      continue
    }
    if (line.trim() === '' || /^(\/\/|\/\*|\*|['"]use )/.test(line)) { i++; continue }
    throw new Error(`${file}: cannot classify top-level line ${i + 1} (${line.slice(0, 60)}) with "only"`)
  }
  return { imports, decls }
}

// Parses one import statement into { type, def, ns, named: [{ text, local }], from } or throws.
function parseImport(imp, file) {
  const m = /^import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\*\s+as\s+([\w$]+)\s*)?(?:\{([^}]*)\}\s*)?from\s*(['"][^'"]+['"])\s*;?\s*$/s.exec(imp.trim())
  if (!m || (!m[2] && !m[3] && m[4] === undefined)) throw new Error(`${file}: cannot classify import "${imp.split('\n')[0].slice(0, 60)}" with "only"`)
  const named = (m[4] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((text) => ({ text, local: text.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim() }))
  return { type: m[1] ?? '', def: m[2], ns: m[3], named, from: m[5] }
}

// Keeps the named declarations (every overload signature of each) and only the imported names
// they use.
function only(text, names, file) {
  const { imports, decls } = blocks(text, file)
  const kept = names.map((n) => {
    const ds = decls.filter((x) => x.name === n)
    if (!ds.length) throw new Error(`${file}: no top-level declaration named ${n}`)
    return ds.map((d) => d.text).join('\n')
  })
  const body = kept.join('\n\n')
  const scan = body.replace(/\.\.\./g, ' ')
  const uses = (id) => new RegExp(`(?<![\\w$.])${id.replace(/\$/g, '\\$')}(?![\\w$])`).test(scan)
  const outImports = []
  for (const imp of imports) {
    const p = parseImport(imp, file)
    const parts = []
    if (p.def && uses(p.def)) parts.push(p.def)
    if (p.ns && uses(p.ns)) parts.push(`* as ${p.ns}`)
    const used = p.named.filter((n) => uses(n.local)).map((n) => n.text)
    if (used.length) parts.push(`{ ${used.join(', ')} }`)
    if (!parts.length) continue
    // A namespace import cannot share a statement with a named list.
    const stmts = parts.some((x) => x.startsWith('* as')) && used.length
      ? [parts.filter((x) => !x.startsWith('{')).join(', '), parts.find((x) => x.startsWith('{'))]
      : [parts.join(', ')]
    for (const st of stmts) outImports.push(`import ${p.type}${st} from ${p.from}`)
  }
  return `${outImports.join('\n')}${outImports.length ? '\n\n' : ''}${body}\n`
}

const ROOT = resolve(process.env.PORT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
if (!/^[0-9a-f]{7,40}$/i.test(String(manifest.commit))) throw new Error(`commit must be a hex sha, got ${JSON.stringify(manifest.commit)}`)

for (const f of manifest.files) {
  const map = manifest.maps[f.map]
  const dest = resolve(ROOT, f.to)
  if (dest !== ROOT && !dest.startsWith(ROOT + sep)) throw new Error(`${f.to} is outside the repository (${ROOT})`)
  if (!map) throw new Error(`no map named ${f.map}`)
  let text = execFileSync('git', ['-C', US, 'show', `${manifest.commit}:${f.from}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (f.only) text = only(text, f.only, f.from)
  text = text.replace(/(from\s+|import\(\s*|vi\.mock\(\s*)(['"])([^'"]+)\2/g, (_all, lead, q, spec) => `${lead}${q}${rewrite(spec, map)}${q}`)
  // Literal, per-file edits the pinned source needs (a scrub of wording that must not ship, or a
  // line the package changes on purpose). A rule that matches nothing is an error, so a rule that
  // has gone stale cannot hide.
  for (const [from, to] of f.replace ?? []) {
    // A "re:" prefix makes the rule a regular expression, for a word that must not be written
    // into this manifest at all (the private-words check reads it too).
    const re = from.startsWith('re:') ? new RegExp(from.slice(3), 'g') : null
    if (!(re ? re.test(text) : text.includes(from))) throw new Error(`${f.from}: replace rule matches nothing: ${JSON.stringify(from.slice(0, 80))}`)
    text = re ? text.replace(new RegExp(from.slice(3), 'g'), to) : text.split(from).join(to)
  }
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
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, text)
  console.log(`${f.from} -> ${f.to}`)
}
