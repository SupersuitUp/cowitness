import { describe, expect, it } from 'vitest'
import { cameraFailure } from './camera-failure.js'

const named = (name: string) => ({ name })

describe('cameraFailure', () => {
  it.each(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'])('%s is denied, with the iPhone path', (name) => {
    const f = cameraFailure(named(name))
    expect(f.kind).toBe('denied')
    expect(f.title).toBe('Camera is blocked for this app.')
    expect(f.help).toContain('Settings → Apps → Safari → Camera → Allow (or Ask)')
    expect(f.help).toContain('aA → Website Settings → Camera')
    expect(f.help).toContain('Try again')
    expect(f.detail).toBeUndefined()
  })

  it.each(['NotReadableError', 'AbortError', 'TrackStartError'])('%s is busy', (name) => {
    expect(cameraFailure(named(name))).toEqual({
      kind: 'busy',
      title: 'Another app is using the camera.',
      help: 'End the video call or close the camera app, then tap Try again.',
    })
  })

  it.each(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'])('%s is none', (name) => {
    expect(cameraFailure(named(name))).toEqual({
      kind: 'none',
      title: 'No camera found.',
      help: 'You can still share a photo you already have.',
    })
  })

  it('an unrecognized name is unknown and shows the name', () => {
    expect(cameraFailure(named('TypeError'))).toEqual({
      kind: 'unknown',
      title: "The camera didn't open.",
      help: 'Tap Try again, or share a photo you already have.',
      detail: '(TypeError)',
    })
  })

  it('reads the name off a real DOMException and an Error', () => {
    expect(cameraFailure(new DOMException('x', 'NotAllowedError')).kind).toBe('denied')
    expect(cameraFailure(new Error('boom')).detail).toBe('(Error)')
  })

  it.each([undefined, null, 'NotAllowedError', 42, {}, { name: '' }, { name: 7 }])('%j has no usable name: unknown, no detail', (v) => {
    const f = cameraFailure(v)
    expect(f.kind).toBe('unknown')
    expect(f.detail).toBeUndefined()
  })
})
