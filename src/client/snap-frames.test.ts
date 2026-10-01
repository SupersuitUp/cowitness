import { describe, expect, it } from 'vitest'
import { INSET_MARGIN, INSET_SHARE, coverSource, frameSize, insetRect, panelLayout } from './snap-frames.js'

describe('frameSize', () => {
  it('keeps a frame the camera already fits inside the upload cap', () => {
    expect(frameSize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 })
  })

  it('caps the long edge like every other upload, keeping the aspect', () => {
    expect(frameSize({ width: 6000, height: 4000 })).toEqual({ width: 4096, height: 2731 })
  })
})

describe('insetRect', () => {
  it('sits top-left, sized off the short edge so a portrait and a landscape frame agree', () => {
    const portrait = insetRect({ width: 1080, height: 1920 })
    const landscape = insetRect({ width: 1920, height: 1080 })
    expect(portrait.width).toBe(landscape.width)
    expect(portrait.height).toBe(landscape.height)
    expect(portrait.width).toBe(Math.round(1080 * INSET_SHARE))
    expect(portrait.x).toBe(Math.round(1080 * INSET_MARGIN))
    expect(portrait.y).toBe(portrait.x)
  })

  it('takes the selfie\'s own shape: a selfie taken sideways sits sideways, the same size turned', () => {
    const upright = insetRect({ width: 1920, height: 1080 })
    const sideways = insetRect({ width: 1920, height: 1080 }, { width: 1280, height: 720 })
    expect(sideways.width).toBe(upright.height)
    expect(sideways.height).toBe(upright.width)
    expect(insetRect({ width: 1920, height: 1080 }, { width: 720, height: 1280 })).toEqual(upright)
  })

  it('is portrait, taller than it is wide', () => {
    const r = insetRect({ width: 1080, height: 1920 })
    expect(r.height).toBeGreaterThan(r.width)
  })

  it('leaves the inset inside the frame even when the frame is tiny', () => {
    const r = insetRect({ width: 240, height: 180 })
    expect(r.x + r.width).toBeLessThanOrEqual(240)
    expect(r.y + r.height).toBeLessThanOrEqual(180)
  })
})

describe('coverSource', () => {
  it('takes the whole source when the aspects already agree', () => {
    expect(coverSource({ width: 1200, height: 1600 }, { width: 300, height: 400 }))
      .toEqual({ x: 0, y: 0, width: 1200, height: 1600 })
  })

  it('crops the sides of a source wider than the destination, evenly', () => {
    // 1600x900 into a 3:4 hole: keep 675 wide, centred.
    expect(coverSource({ width: 1600, height: 900 }, { width: 300, height: 400 }))
      .toEqual({ x: 463, y: 0, width: 675, height: 900 })
  })

  it('crops the top and bottom of a source taller than the destination, evenly', () => {
    // 900x1600 into a square: keep 900 tall, centred.
    expect(coverSource({ width: 900, height: 1600 }, { width: 400, height: 400 }))
      .toEqual({ x: 0, y: 350, width: 900, height: 900 })
  })
})

describe('panelLayout', () => {
  it('puts two tall panels side by side, so a portrait screenshot fits its own', () => {
    const l = panelLayout({ width: 1080, height: 1920 })
    expect(l.frame).toEqual({ width: 2160, height: 1920 })
    expect(l.camera).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
    expect(l.screenshot).toEqual({ x: 1080, y: 0, width: 1080, height: 1920 })
  })

  it('stacks two wide panels, because side by side would crush both', () => {
    const l = panelLayout({ width: 1920, height: 1080 })
    expect(l.frame).toEqual({ width: 1920, height: 2160 })
    expect(l.camera).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(l.screenshot).toEqual({ x: 0, y: 1080, width: 1920, height: 1080 })
  })

  it('treats a square frame as tall, so the seam is always somewhere', () => {
    const l = panelLayout({ width: 1000, height: 1000 })
    expect(l.frame).toEqual({ width: 2000, height: 1000 })
    expect(l.screenshot.x).toBe(1000)
  })

  it('caps the doubled frame like every other upload', () => {
    const l = panelLayout({ width: 3000, height: 4000 })
    expect(Math.max(l.frame.width, l.frame.height)).toBeLessThanOrEqual(4096)
    expect(l.camera.width + l.screenshot.width).toBe(l.frame.width)
    expect(l.camera.height).toBe(l.frame.height)
  })
})
