import { describe, expect, it } from 'vitest'
import { nativePlatform } from './platform'

const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36'
const IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

describe('nativePlatform', () => {
  it('names the shell the app runs in', () => {
    expect(nativePlatform(true, ANDROID)).toBe('android')
    expect(nativePlatform(true, IOS)).toBe('ios')
  })

  it('is nothing on the web, whatever the browser is', () => {
    expect(nativePlatform(false, ANDROID)).toBeNull()
    expect(nativePlatform(false, IOS)).toBeNull()
  })
})
