import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { drawCameras, drawWithScreen, encodeSnap, previewUrl, snapFile } from './snap-compose.js'
import { INSET_RADIUS, coverSource, insetRect, panelLayout } from './snap-frames.js'
import type { Frame } from './dual-camera.js'

// jsdom has no 2d context and no JPEG encoder, so both are stood in for; what is under test is
// what gets drawn where, what gets let go of, and how many times the pixels are encoded.
type Op = { op: string; args: unknown[] }
type Stub = { width: number; height: number; toBlobCalls: number; toDataUrlCalls: number }

describe('composing', () => {
  let ops: Op[]
  let canvases: Stub[]
  let encode: (cb: (b: Blob | null) => void) => void
  const created = document.createElement.bind(document)

  const frame = (width: number, height: number, name: string): Frame =>
    ({ image: name as unknown as CanvasImageSource, width, height, release: vi.fn() })

  beforeEach(() => {
    ops = []
    canvases = []
    encode = (cb) => cb(new Blob(['j'], { type: 'image/jpeg' }))
    const record = (op: string) => (...args: unknown[]) => { ops.push({ op, args }) }
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return created(tag)
      const c: Stub & Record<string, unknown> = {
        width: 300, height: 150, toBlobCalls: 0, toDataUrlCalls: 0,
        getContext: () => ({
          drawImage: record('drawImage'), roundRect: record('roundRect'), rect: record('rect'),
          beginPath: record('beginPath'), clip: record('clip'), save: record('save'),
          translate: record('translate'), scale: record('scale'),
          restore: record('restore'), stroke: record('stroke'),
          set lineWidth(v: number) { ops.push({ op: 'lineWidth', args: [v] }) },
          set strokeStyle(v: string) { ops.push({ op: 'strokeStyle', args: [v] }) },
        }),
        toBlob: (cb: (b: Blob | null) => void) => { c.toBlobCalls++; encode(cb) },
        toDataURL: () => { c.toDataUrlCalls++; return 'data:image/jpeg;base64,p' },
      }
      canvases.push(c as unknown as Stub)
      return c
    }) as typeof document.createElement)
  })
  afterEach(() => vi.restoreAllMocks())

  it('draws the cameras onto a canvas and encodes nothing yet', () => {
    const back = frame(1080, 1920, 'back')
    const front = frame(1280, 720, 'front')
    const canvas = drawCameras({ back, front })
    expect(canvases[0]).toEqual(expect.objectContaining({ width: 1080, height: 1920, toBlobCalls: 0 }))
    const draw = ops.filter((o) => o.op === 'drawImage')
    const from = coverSource({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })
    expect(draw[0].args).toEqual(['back', from.x, from.y, from.width, from.height, 0, 0, 1080, 1920])
    // The selfie was taken sideways (1280x720), so its box is sideways too, never cropped to portrait.
    const box = insetRect({ width: 1080, height: 1920 }, { width: 1280, height: 720 })
    expect(box.width).toBeGreaterThan(box.height)
    expect(ops.filter((o) => o.op === 'roundRect')[0].args)
      .toEqual([box.x, box.y, box.width, box.height, Math.round(box.width * INSET_RADIUS)])
    expect(back.release).toHaveBeenCalledTimes(1)
    expect(front.release).toHaveBeenCalledTimes(1)
    expect(canvas).toBe(canvases[0] as unknown as HTMLCanvasElement)
  })

  it('draws the selfie mirrored, the way it looked on screen before the shutter', () => {
    drawCameras({ back: frame(1080, 1920, 'back'), front: frame(720, 1280, 'front') })
    const box = insetRect({ width: 1080, height: 1920 }, { width: 720, height: 1280 })
    const i = ops.findIndex((o) => o.op === 'drawImage' && o.args[0] === 'front')
    const before = ops.slice(0, i).map((o) => [o.op, ...o.args])
    expect(before).toContainEqual(['translate', box.x * 2 + box.width, 0])
    expect(before).toContainEqual(['scale', -1, 1])
  })

  it('draws the back frame alone when there is no selfie', () => {
    drawCameras({ back: frame(1080, 1920, 'back'), front: null })
    expect(ops.filter((o) => o.op === 'drawImage')).toHaveLength(1)
    expect(ops.some((o) => o.op === 'clip')).toBe(false)
  })

  it('lays a screenshot beside the CAMERA CANVAS, so those pixels are never re-encoded', () => {
    const cameras = drawCameras({ back: frame(1080, 1920, 'back'), front: null })
    const encodesBefore = canvases[0].toBlobCalls
    ops.length = 0
    const screen = frame(1170, 2532, 'screen')
    drawWithScreen(cameras, screen)
    const panels = panelLayout({ width: 1080, height: 1920 })
    expect(canvases[1]).toEqual(expect.objectContaining({ width: panels.frame.width, height: panels.frame.height }))
    const draws = ops.filter((o) => o.op === 'drawImage')
    expect(draws).toHaveLength(2)
    // The camera canvas itself is the source, not a jpeg decoded back from one.
    // Whole canvas in, whole panel out: a source rect of anything else silently crops the cameras.
    expect(draws[0].args).toEqual([cameras, 0, 0, 1080, 1920,
      panels.camera.x, panels.camera.y, panels.camera.width, panels.camera.height])
    const fromScreen = coverSource({ width: 1170, height: 2532 }, panels.screenshot)
    expect(draws[1].args).toEqual(['screen', fromScreen.x, fromScreen.y, fromScreen.width, fromScreen.height,
      panels.screenshot.x, panels.screenshot.y, panels.screenshot.width, panels.screenshot.height])
    expect(screen.release).toHaveBeenCalledTimes(1)
    expect(canvases[0].toBlobCalls).toBe(encodesBefore)
  })

  it('encodes the pixels exactly once, when the snap is finally taken', async () => {
    const cameras = drawCameras({ back: frame(1080, 1920, 'back'), front: null })
    const out = await encodeSnap(cameras)
    expect(out.type).toBe('image/jpeg')
    expect(canvases[0].toBlobCalls).toBe(1)
  })

  it('reports an encode that produced nothing rather than sending an empty snap', async () => {
    const cameras = drawCameras({ back: frame(1080, 1920, 'back'), front: null })
    encode = (cb) => cb(null)
    await expect(encodeSnap(cameras)).rejects.toThrow('encode failed')
  })

  it('previews from the same canvas without touching the pixels that get sent', () => {
    const cameras = drawCameras({ back: frame(1080, 1920, 'back'), front: null })
    expect(previewUrl(cameras)).toBe('data:image/jpeg;base64,p')
    expect(canvases[0].toBlobCalls).toBe(0)
  })
})

describe('snapFile', () => {
  it('names the composed bytes as a jpeg the snap path already knows how to send', () => {
    const file = snapFile(new Blob(['j'], { type: 'image/jpeg' }))
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/\.jpg$/)
    expect(file.lastModified).toBeGreaterThan(0)
  })
})
