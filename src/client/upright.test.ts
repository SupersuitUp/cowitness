import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askForMotion, quarterTurnsFrom, readTilt, resetMotion, turnedSize } from './upright.js'

// deviceorientation angles in degrees. Held upright in portrait: beta 90, gamma 0.
const PORTRAIT = { beta: 90, gamma: 0 }
// Turned a quarter anticlockwise (as you look at the screen), so the phone's RIGHT edge is up.
const RIGHT_EDGE_UP = { beta: 0, gamma: -89 }
// Turned a quarter clockwise, so the LEFT edge is up.
const LEFT_EDGE_UP = { beta: 0, gamma: 89 }
const UPSIDE_DOWN = { beta: -90, gamma: 0 }
const FLAT = { beta: 2, gamma: 3 }

describe('how many clockwise quarter turns stand a frame upright', () => {
  it('portrait needs none, from either camera', () => {
    expect(quarterTurnsFrom(PORTRAIT, 'environment')).toBe(0)
    expect(quarterTurnsFrom(PORTRAIT, 'user')).toBe(0)
  })

  it('landscape turns the back camera\'s frame so the edge that was up is the top', () => {
    // Right edge up: the frame's right side is the sky, so it turns a quarter anticlockwise.
    expect(quarterTurnsFrom(RIGHT_EDGE_UP, 'environment')).toBe(3)
    expect(quarterTurnsFrom(LEFT_EDGE_UP, 'environment')).toBe(1)
  })

  it('the front camera sees the world the other way round, so it turns the other way', () => {
    expect(quarterTurnsFrom(RIGHT_EDGE_UP, 'user')).toBe(1)
    expect(quarterTurnsFrom(LEFT_EDGE_UP, 'user')).toBe(3)
  })

  it('upside down is a half turn', () => {
    expect(quarterTurnsFrom(UPSIDE_DOWN, 'environment')).toBe(2)
  })

  it('a phone lying flat, or no reading at all, leaves the frame as the camera gave it', () => {
    expect(quarterTurnsFrom(FLAT, 'environment')).toBe(0)
    expect(quarterTurnsFrom(null, 'environment')).toBe(0)
  })

  it('when the screen has turned with the phone, the camera already delivers it upright: no turn', () => {
    // Rotation lock off: iOS turns the page AND the camera stream, so turning again would put the
    // picture back on its side (what Ana saw on 2026-09-29).
    expect(quarterTurnsFrom(RIGHT_EDGE_UP, 'environment', 90)).toBe(0)
    expect(quarterTurnsFrom(LEFT_EDGE_UP, 'environment', -90)).toBe(0)
    expect(quarterTurnsFrom(LEFT_EDGE_UP, 'user', 270)).toBe(0)
  })

  it('with the screen still portrait, the sensor decides (rotation lock on)', () => {
    expect(quarterTurnsFrom(RIGHT_EDGE_UP, 'environment', 0)).toBe(3)
  })

  it('a tilted landscape hold still counts as landscape', () => {
    expect(quarterTurnsFrom({ beta: 20, gamma: -60 }, 'environment')).toBe(3)
  })
})

describe('a turned frame', () => {
  it('swaps its sides on a quarter turn and keeps them on a half turn', () => {
    expect(turnedSize({ width: 1080, height: 1920 }, 1)).toEqual({ width: 1920, height: 1080 })
    expect(turnedSize({ width: 1080, height: 1920 }, 3)).toEqual({ width: 1920, height: 1080 })
    expect(turnedSize({ width: 1080, height: 1920 }, 2)).toEqual({ width: 1080, height: 1920 })
  })
})

describe('the motion sensor', () => {
  beforeEach(resetMotion)

  it('asks iOS for permission inside the tap, and listens once it is granted', async () => {
    const requestPermission = vi.fn(async () => 'granted')
    const add = vi.fn()
    await askForMotion({ requestPermission }, { addEventListener: add })
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('deviceorientation', expect.any(Function))
  })

  it('does not listen when refused, so the frame is taken as the camera gives it', async () => {
    const add = vi.fn()
    await askForMotion({ requestPermission: async () => 'denied' }, { addEventListener: add })
    expect(add).not.toHaveBeenCalled()
  })

  it('a browser that needs no permission just listens', async () => {
    const add = vi.fn()
    await askForMotion({}, { addEventListener: add })
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest reading, and ignores an event with no angles', async () => {
    let listener: (e: { beta: number | null; gamma: number | null }) => void = () => {}
    await askForMotion({}, { addEventListener: (_: string, l: typeof listener) => { listener = l } })
    listener({ beta: 90, gamma: 0 })
    listener({ beta: null, gamma: null })
    expect(readTilt()).toEqual({ beta: 90, gamma: 0 })
  })
})
