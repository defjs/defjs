import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { browserLaunchEnv } from '../../../../test/firefox-app-data'

test('isolates the Firefox workaround and leaves the non-macOS branch untouched', () => {
  const before = { ...process.env }
  const env = browserLaunchEnv()
  expect(JSON.stringify(process.env) === JSON.stringify(before)).toBe(true)
  if (process.platform === 'darwin') {
    expect(env?.['MOZ_APP_DATA']).toBe(before['MOZ_APP_DATA'] ?? join(tmpdir(), 'defjs-firefox-app-data', 'roaming'))
    expect(env?.['MOZ_LOCAL_APP_DATA']).toBeTruthy()
  }
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) throw new Error('Expected a platform descriptor')
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(browserLaunchEnv()).toBeUndefined()
    expect(JSON.stringify(process.env) === JSON.stringify(before)).toBe(true)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})
