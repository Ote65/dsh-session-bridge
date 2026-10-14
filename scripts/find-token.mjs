/**
 * Hunt for a GitHub credential on this machine.
 *
 * Reports WHERE something was found and a masked fingerprint; never the value.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()

/** Mask a secret down to something safe to print. */
function mask(value) {
  const text = String(value)
  if (text.length <= 8) return `<len=${text.length}>`
  return `${text.slice(0, 7)}…${text.slice(-4)} (len=${text.length})`
}

/** Does this look like a GitHub token? */
function looksLikeToken(value) {
  return /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/.test(String(value).trim())
}

console.log('=== 1. environment at every scope ===')
const names = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT', 'GH_PAT', 'GITHUB_ACCESS_TOKEN', 'DSH_GITHUB_TOKEN', 'GIT_TOKEN']
for (const scope of ['Process', 'User', 'Machine']) {
  for (const name of names) {
    let value = null
    try {
      value = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `[Environment]::GetEnvironmentVariable('${name}','${scope}')`], { encoding: 'utf8' }).trim()
    } catch (error) { value = null }
    if (value) console.log(`  ${scope}/${name} = ${mask(value)}  tokenish=${looksLikeToken(value)}`)
  }
}
console.log('  (blank above means absent at that scope)')

console.log('\n=== 2. ~/.dsh/.credentials.yaml records (keys unmasked) ===')
try {
  const text = readFileSync(join(HOME, '.dsh', '.credentials.yaml'), 'utf8')
  console.log(text.replace(/(secret:\s*)(\S+)/g, (_m, p, v) => `${p}${mask(v)}`))
} catch (error) { console.log('  unreadable:', error.message) }

console.log('\n=== 3. the usual credential files ===')
const candidates = [
  '.git-credentials', '.netrc', '_netrc', '.npmrc', '.yarnrc', '.yarnrc.yml',
  '.config/gh/hosts.yml', '.config/git/credentials', '.gitconfig',
  'AppData/Roaming/GitHub CLI/hosts.yml',
  'AppData/Roaming/Code/User/settings.json',
]
for (const relative of candidates) {
  const path = join(HOME, relative)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf8')
  const hits = [...text.matchAll(/(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g)]
  console.log(`  FOUND ${relative} (${statSync(path).size}B)` + (hits.length ? `  <- ${hits.length} token-shaped string(s): ${hits.map((h) => mask(h[0])).join(', ')}` : ''))
}

console.log('\n=== 4. gh CLI config / hosts ===')
for (const relative of ['.config/gh', 'AppData/Roaming/GitHub CLI', 'AppData/Local/GitHub CLI']) {
  const path = join(HOME, relative)
  if (existsSync(path)) console.log(`  dir exists: ${relative} -> ${readdirSync(path).join(', ')}`)
}

console.log('\n=== 5. shallow grep for token literals in likely config roots ===')
const roots = [
  join(HOME, '.dsh'),
  join(HOME, '.config'),
  join(HOME, '.ssh'),
  join(HOME, '.codex'),
  join(HOME, '.claude'),
  join(HOME, '.gemini'),
  join(HOME, '.trae'),
  join(HOME, 'AppData/Roaming'),
]
const seen = []
function walk(dir, depth) {
  if (depth > 3 || seen.length > 40) return
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry)
    let info
    try { info = statSync(path) } catch { continue }
    if (info.isDirectory()) {
      if (/node_modules|cache|logs|Code Cache|GPUCache|Crashes|blob_storage/i.test(entry)) continue
      walk(path, depth + 1)
      continue
    }
    if (info.size > 2_000_000) continue
    if (/\.(json|ya?ml|toml|txt|env|ini|conf|cfg|properties|ps1|sh|md)$/i.test(entry) === false && entry.includes('.') === false) continue
    let text = ''
    try { text = readFileSync(path, 'utf8') } catch { continue }
    const hits = [...text.matchAll(/(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g)]
    if (hits.length === 0) continue
    seen.push(path)
    console.log(`  ${path.replace(HOME, '~')}`)
    for (const hit of hits.slice(0, 3)) console.log(`      ${mask(hit[0])}`)
  }
}
for (const root of roots) if (existsSync(root)) walk(root, 0)
if (seen.length === 0) console.log('  no token literal found in the scanned roots')

console.log('\n=== 6. Windows Credential Manager (all targets) ===')
try {
  const out = execFileSync('cmdkey.exe', ['/list'], { encoding: 'utf8' })
  const lines = out.split(/\r?\n/).filter((line) => /目标|Target/i.test(line))
  console.log(lines.length ? lines.map((l) => `  ${l.trim()}`).join('\n') : '  (no targets)')
} catch (error) { console.log('  cmdkey failed:', error.message) }
