import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { frameThumb, grabAndClose, openStream, type Camera, type CameraIo, type Frame } from './dual-camera.js'

const frame = (): Frame => ({ image: {} as CanvasImageSource, width: 4, height: 3, release: vi.fn() })
const camera = (name: string) => ({ name }) as unknown as Camera

// A fake phone. Every call is written down in order, because the order is the thing under test:
// a phone runs one camera at a time, so each one is let go of the moment its frame is taken.
function fakePhone() {
  const log: string[] = []
  const io: CameraIo = {
    open: async (facing) => { log.push(`open:${facing}`); return camera(facing) },
    grab: async (cam) => { log.push(`grab:${(cam as unknown as { name: string }).name}`); return frame() },
    close: (cam) => { log.push(`close:${(cam as unknown as { name: string }).name}`) },
  }
  return { io, log }
}

describe('grabAndClose', () => {
  it('takes the frame and lets the camera go, so the next one can be opened', async () => {
    const { io, log } = fakePhone()
    const taken = await grabAndClose(io, camera('front'))
    expect(taken.width).toBe(4)
    expect(log).toEqual(['grab:front', 'close:front'])
  })

  it('lets the camera go even when its frame cannot be taken', async () => {
    const { io, log } = fakePhone()
    io.grab = async () => { throw new Error('no frame') }
    await expect(grabAndClose(io, camera('front'))).rejects.toThrow('no frame')
    expect(log).toEqual(['close:front'])
  })
})

describe('frameThumb', () => {
  let drawn: unknown[]
  let sized: Array<{ width: number; height: number }>
  const created = document.createElement.bind(document)

  beforeEach(() => {
    drawn = []
    sized = []
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return created(tag)
      const c = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (...a: unknown[]) => drawn.push(a) }),
        toDataURL: () => { sized.push({ width: c.width, height: c.height }); return 'data:image/jpeg;base64,x' },
      }
      return c
    }) as typeof document.createElement)
  })
  afterEach(() => vi.restoreAllMocks())

  it('shrinks the frame to a corner-sized jpeg, keeping its shape', () => {
    const url = frameThumb({ image: 'f' as unknown as CanvasImageSource, width: 1280, height: 720, release: vi.fn() }, 320)
    expect(url).toBe('data:image/jpeg;base64,x')
    expect(sized[0]).toEqual({ width: 320, height: 180 })
    expect(drawn[0]).toEqual(['f', 0, 0, 320, 180])
  })

  it('never enlarges a frame that is already small', () => {
    frameThumb({ image: 'f' as unknown as CanvasImageSource, width: 100, height: 200, release: vi.fn() }, 320)
    expect(sized[0]).toEqual({ width: 100, height: 200 })
  })
})

describe('openStream', () => {
  it('rejects as a missing camera, by name, when the browser has no mediaDevices', async () => {
    const saved = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    try {
      await expect(openStream('user')).rejects.toMatchObject({ name: 'NotFoundError' })
    } finally {
      if (saved) Object.defineProperty(navigator, 'mediaDevices', saved)
      else delete (navigator as unknown as Record<string, unknown>).mediaDevices
    }
  })
})
