/**
 * Fail the release if `npm pack --dry-run` omits LICENSE, README.md, package.json,
 * or any file referenced by the package's entry fields.
 *
 * Run it in the publish directory (the directory `npm publish` uses):
 *   bun test/assert-pack.ts packages/core/dist
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'

interface PackFile {
  path: string
}

interface PackDocument {
  files: PackFile[]
  name?: string
  version?: string
}

const REQUIRED_ROOT_FILES = ['LICENSE', 'README.md', 'package.json']

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function isPackFile(value: unknown): value is PackFile {
  return typeof value === 'object' && value !== null && 'path' in value && typeof value.path === 'string'
}

function isPackDocument(value: unknown): value is PackDocument {
  return typeof value === 'object' && value !== null && 'files' in value && Array.isArray(value.files) && value.files.every(isPackFile)
}

function toRelativePackedPath(value: string): string | undefined {
  if (value.startsWith('/') || value.includes('://') || value.startsWith('#')) {
    return undefined
  }

  const stripped = value.startsWith('./') ? value.slice(2) : value
  if (stripped === '' || (!stripped.includes('.') && !stripped.includes('/'))) {
    return undefined
  }

  const normalized = posix.normalize(stripped)
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    fail(`assert-pack: export path escapes the package: ${value}`)
  }
  return normalized
}

function collectPaths(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    const relative = toRelativePackedPath(value)
    if (relative !== undefined) {
      into.add(relative)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, into)
    }
    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      collectPaths(entry, into)
    }
  }
}

function requiredFiles(publishDir: string): Set<string> {
  const manifestPath = resolve(publishDir, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`assert-pack: cannot read ${manifestPath}\n${message}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    fail(`assert-pack: ${manifestPath} is not an object`)
  }

  const required = new Set<string>(REQUIRED_ROOT_FILES)
  for (const [field, value] of Object.entries(parsed)) {
    if (['exports', 'types', 'main', 'module', 'typings', 'unpkg', 'jsdelivr'].includes(field)) {
      collectPaths(value, required)
    }
  }
  return required
}

function packedFiles(publishDir: string): { id: string; paths: Set<string> } {
  let stdout = ''
  try {
    stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], {
      cwd: publishDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`assert-pack: npm pack --dry-run failed in ${publishDir}\n${message}`)
  }

  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start === -1 || end < start) {
    fail(`assert-pack: npm pack --json did not return a JSON array\n${stdout}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(`assert-pack: cannot parse npm pack JSON\n${message}`)
  }

  if (!Array.isArray(parsed) || !parsed.every(isPackDocument)) {
    fail('assert-pack: unexpected npm pack JSON')
  }

  const document = parsed[0]
  if (!document) {
    fail('assert-pack: npm pack returned no package')
  }

  const paths = new Set(document.files.map((file) => (file.path.startsWith('package/') ? file.path.slice('package/'.length) : file.path)))
  const name = typeof document.name === 'string' ? document.name : '(unknown)'
  const version = typeof document.version === 'string' ? document.version : '(unknown)'
  return { id: `${name}@${version}`, paths }
}

const publishDirArg = process.argv[2]
if (!publishDirArg || process.argv.length > 3) {
  fail('usage: bun test/assert-pack.ts <publish-directory>')
}

const publishDir = resolve(publishDirArg)
const required = requiredFiles(publishDir)
const packed = packedFiles(publishDir)
const missing = [...required].filter((file) => !packed.paths.has(file)).sort()

console.log(`assert-pack: ${packed.id}`)
console.log(`packed: ${[...packed.paths].sort().join(', ')}`)
console.log(`required: ${[...required].sort().join(', ')}`)

if (missing.length > 0) {
  fail(`assert-pack: missing from npm pack --dry-run: ${missing.join(', ')}`)
}

console.log('assert-pack: ok')
