import { describe, expect, it, vi, afterEach } from 'vitest'
import { capturePoster, isMostlyBlack, isVideoFile, localWallClock, readVideoMeta, videoContentType, videoProblem } from './video-meta.js'

const file = (name: string, type: string, size?: number) => {
  const f = new File(['x'], name, { type })
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

// jsdom cannot decode video, so a stand-in element plays the browser's part.
function fakeVideo(behave: (v: FakeVideo) => void) {
  const made: FakeVideo[] = []
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas' && canvasPixel) return makeCanvas(canvasPixel) as unknown as HTMLElement
    if (tag !== 'video') return real(tag)
    const v = new FakeVideo(behave)
    made.push(v)
    return v as unknown as HTMLElement
  }) as typeof document.createElement)
  return made
}
class FakeVideo {
  duration = NaN; videoWidth = 0; videoHeight = 0; muted = false; playsInline = false; preload = ''
  onloadedmetadata: (() => void) | null = null
  onseeked: (() => void) | null = null
  onerror: (() => void) | null = null
  released = false
  seeks = false
  loadedWithSrc = 0
  attrs: Record<string, string> = {}
  private _src = ''
  constructor(private behave: (v: FakeVideo) => void) {}
  set src(v: string) { this._src = v; queueMicrotask(() => this.behave(this)) }
  get src() { return this._src }
  // A stuck decoder never seeks unless the test says it does.
  set currentTime(_t: number) { if (this.seeks) queueMicrotask(() => this.onseeked?.()) }
  removeAttribute() { this.released = true; this._src = '' }
  load() { if (this._src) this.loadedWithSrc += 1 }
  setAttribute(k: string, v: string) { this.attrs[k] = v }
}

// A canvas whose pixels are whatever the test says the frame looked like.
let canvasPixel: [number, number, number] | null = null
function fakeCanvas(pixel: [number, number, number]) { canvasPixel = pixel }
function makeCanvas(pixel: [number, number, number]) {
  return {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let i = 0; i < data.length; i += 4) { data[i] = pixel[0]; data[i + 1] = pixel[1]; data[i + 2] = pixel[2]; data[i + 3] = 255 }
        return { data, width: w, height: h }
      },
    }),
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
  }
}

describe('video helpers', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); canvasPixel = null })

  it('recognises a video by type, or by extension when the phone gives no type', () => {
    expect(isVideoFile(file('a.mov', 'video/quicktime'))).toBe(true)
    expect(isVideoFile(file('a.MOV', ''))).toBe(true)
    expect(isVideoFile(file('a.jpg', 'image/jpeg'))).toBe(false)
    expect(videoContentType(file('a.mov', ''))).toBe('video/quicktime')
    expect(videoContentType(file('a.mp4', ''))).toBe('video/mp4')
    expect(videoContentType(file('a.m4v', 'video/x-m4v'))).toBe('video/mp4')
    expect(videoContentType(file('a.webm', 'video/webm'))).toBeNull()
  })

  it('names what stops a video before anything is read', () => {
    expect(videoProblem(file('a.mov', 'video/quicktime', 4294967297))).toBe('This video is too large to add')
    expect(videoProblem(file('a.webm', 'video/webm'))).toBe("Couldn't read this video")
    expect(videoProblem(file('a.mov', 'video/quicktime', 4294967296))).toBeNull()
  })

  it('writes the phone\'s local wall-clock time, with no zone', () => {
    expect(localWallClock(new Date(2026, 8, 15, 21, 4, 9).getTime())).toBe('2026-09-15T21:04:09')
  })

  it('reads duration and size from metadata, and gives the object URL back', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    fakeVideo((v) => { v.duration = 12.5; v.videoWidth = 1080; v.videoHeight = 1920; v.onloadedmetadata?.() })
    await expect(readVideoMeta(file('a.mov', 'video/quicktime'))).resolves.toEqual({ durationSec: 12.5, width: 1080, height: 1920 })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v')
  })

  it('treats a zero or unknown duration, or a decode error, as unreadable', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    fakeVideo((v) => { v.duration = 0; v.videoWidth = 10; v.videoHeight = 10; v.onloadedmetadata?.() })
    await expect(readVideoMeta(file('a.mov', 'video/quicktime'))).resolves.toBeNull()
    vi.restoreAllMocks()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    fakeVideo((v) => { v.onerror?.() })
    await expect(readVideoMeta(file('a.mov', 'video/quicktime'))).resolves.toBeNull()
  })

  it('gives up on a poster after 3 seconds and releases the video', async () => {
    vi.useFakeTimers()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    const made = fakeVideo((v) => { v.duration = 5; v.videoWidth = 1080; v.videoHeight = 1920; v.onloadedmetadata?.() })
    const poster = capturePoster(file('a.mov', 'video/quicktime'))
    await vi.advanceTimersByTimeAsync(3000)
    await expect(poster).resolves.toBeNull()
    expect(made[0].released).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:v')
  })

  it('loads the detached element explicitly, muted and inline, so iOS starts reading it', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    const made = fakeVideo((v) => { v.duration = 3; v.videoWidth = 10; v.videoHeight = 10; v.onloadedmetadata?.() })
    await readVideoMeta(file('a.mov', 'video/quicktime'))
    expect(made[0].loadedWithSrc).toBe(1)
    expect(made[0].muted).toBe(true)
    expect(made[0].playsInline).toBe(true)
    expect(made[0].attrs).toEqual(expect.objectContaining({ muted: '', playsinline: '' }))
  })

  it('refuses an all-black frame as a poster', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    const made = fakeVideo((v) => { v.seeks = true; v.duration = 5; v.videoWidth = 1080; v.videoHeight = 1920; v.onloadedmetadata?.() })
    fakeCanvas([3, 4, 2])
    await expect(capturePoster(file('a.mov', 'video/quicktime'))).resolves.toBeNull()
    expect(made[0].released).toBe(true)
  })

  it('keeps a real frame as the poster', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    fakeVideo((v) => { v.seeks = true; v.duration = 5; v.videoWidth = 1080; v.videoHeight = 1920; v.onloadedmetadata?.() })
    fakeCanvas([180, 120, 60])
    const poster = await capturePoster(file('a.mov', 'video/quicktime'))
    expect(poster).toBeInstanceOf(Blob)
  })

  it('reads mean brightness from a pixel sample', () => {
    const px = (v: number) => new Uint8ClampedArray([v, v, v, 255, v, v, v, 255])
    expect(isMostlyBlack(px(7))).toBe(true)
    expect(isMostlyBlack(px(40))).toBe(false)
  })
})
