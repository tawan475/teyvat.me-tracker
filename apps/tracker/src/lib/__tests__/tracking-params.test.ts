import { describe, expect, it } from 'vitest'
import { isTrackingParam, withoutTracking } from '../tracking-params'

describe('tracking values in links', () => {
  it('knows the click ids and every utm_ tag, in any case', () => {
    for (const key of [
      'fbclid',
      'gclid',
      'msclkid',
      'igshid',
      'ttclid',
      'utm_source',
      'UTM_Medium',
      'utm_whatever',
    ]) {
      expect(isTrackingParam(key)).toBe(true)
    }
    // The site's own query values stay.
    for (const key of ['c', 'w', 'run', 'next', 'enemy', 'at', 'device', 'oauth_error', 'utm']) {
      expect(isTrackingParam(key)).toBe(false)
    }
  })

  it('drops them and keeps everything else as written, in order', () => {
    expect(withoutTracking('')).toBeNull()
    expect(withoutTracking('?')).toBeNull()
    expect(withoutTracking('?c=HuTao&run=c%3A2026')).toBeNull()
    expect(withoutTracking('?fbclid=IwAR0abc')).toBe('')
    expect(withoutTracking('?utm_source=discord&utm_medium=social')).toBe('')
    expect(withoutTracking('?c=HuTao&fbclid=IwAR0abc&w=Moonpiercer')).toBe('?c=HuTao&w=Moonpiercer')
    expect(withoutTracking('?next=%2Fapp%3Fx%3D1&gclid=x')).toBe('?next=%2Fapp%3Fx%3D1')
    // A value that only mentions one is not one.
    expect(withoutTracking('?q=fbclid')).toBeNull()
    // Encoded and odd keys.
    expect(withoutTracking('?utm%5Fsource=x&a=1')).toBe('?a=1')
    expect(withoutTracking('?%E0%A4%A=1&fbclid=2')).toBe('?%E0%A4%A=1')
    expect(withoutTracking('?a=1&&fbclid=2')).toBe('?a=1')
  })
})
