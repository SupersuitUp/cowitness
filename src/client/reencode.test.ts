import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { toJpeg } from './reencode.js'

// jsdom has no bitmap decoding or canvas encoder, so both are stood in for here;
// what is under test is which path runs and what gets released.
describe('toJpeg', () => {
  let canvases: Array<{ width: number; height: number; drawn: unknown[] }>
  const created = document.createElement.bind(document)

  beforeEach(() => {
    canvases = []
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return created(tag)
      const drawn: unknown[] = []
      const c = {
        width: 300, height: 150, drawn,
        getContext: () => ({ drawImage: (img: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ img, w, h }) }),
        toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob(['j'], { type })),
      }
      canvases.push(c)
      return c
    }) as typeof document.createElement)
    URL.createObjectURL = vi.fn(() => 'blob:photo')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
  })

  // jsdom does not implement HTMLImageElement.decode at all.
  const setDecode = (fn: () => Promise<void>) =>
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: fn, configurable: true, writable: true })

  it('decodes with createImageBitmap, closes the bitmap, and frees the canvas', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8000, height: 6000, close })))
    const out = await toJpeg(new Blob(['raw']))
    expect(out.type).toBe('image/jpeg')
    expect(canvases[0].drawn[0]).toEqual(expect.objectContaining({ w: 4096, h: 3072 }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(canvases[0]).toEqual(expect.objectContaining({ width: 0, height: 0 }))
  })

  it('falls back to an <img> when createImageBitmap throws, and revokes the blob URL', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new TypeError('imageOrientation unsupported') }))
    const decode = vi.fn(async () => {})
    setDecode(decode)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(3024)
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(4032)
    const out = await toJpeg(new Blob(['raw']))
    expect(out.type).toBe('image/jpeg')
    expect(decode).toHaveBeenCalled()
    const drawn = canvases[0].drawn[0] as { img: HTMLImageElement; w: number; h: number }
    expect(drawn.img).toBeInstanceOf(HTMLImageElement)
    expect(drawn).toEqual(expect.objectContaining({ w: 3024, h: 4032 }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
    expect(canvases[0]).toEqual(expect.objectContaining({ width: 0, height: 0 }))
  })

  it('still frees the canvas and revokes the URL when encoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('nope') }))
    setDecode(vi.fn(async () => { throw new Error('bad image') }))
    await expect(toJpeg(new Blob(['raw']))).rejects.toThrow('bad image')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
    expect(canvases).toHaveLength(0)
  })
})
