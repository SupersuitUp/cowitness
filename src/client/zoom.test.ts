import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIGITAL_MAX, applyHardwareZoom, cropFrame, hardwareZoomer, pinchZoom, zoomLabel, zoomRange, zoomSteps } from './zoom.js'

const aTrack = (zoom?: { min: number; max: number }, current?: number) => ({
  getCapabilities: () => (zoom ? { zoom } : {}),
  getSettings: () => (current === undefined ? {} : { zoom: current }),
  applyConstraints: vi.fn(async () => {}),
}) as unknown as MediaStreamTrack

describe('zoomRange', () => {
  it('zooms the camera itself when the camera says it can', () => {
    expect(zoomRange(aTrack({ min: 1, max: 10 }, 1))).toEqual({ min: 1, max: 10, base: 1, hardware: true })
  })

  it('counts from the zoom the camera opened at, so 1× is the view first shown', () => {
    expect(zoomRange(aTrack({ min: 1, max: 15 }, 2)).base).toBe(2)
  })

  it('falls back to a digital zoom when the camera reports none, or a range with no room', () => {
    const digital = { min: 1, max: DIGITAL_MAX, base: 1, hardware: false }
    expect(zoomRange(aTrack())).toEqual(digital)
    expect(zoomRange(aTrack({ min: 1, max: 1 }))).toEqual(digital)
    expect(zoomRange(undefined)).toEqual(digital)
  })
})

describe('zoomSteps', () => {
  it('offers 1×, 2× and 3× for a digital zoom', () => {
    expect(zoomSteps(zoomRange(undefined))).toEqual([1, 2, 3])
  })

  it('offers 0.5× when the camera opened above its widest, and 5× in place of 3× when it reaches it', () => {
    expect(zoomSteps({ min: 1, max: 15, base: 2, hardware: true })).toEqual([0.5, 1, 2, 5])
  })

  it('labels a zoom relative to the opening view', () => {
    expect(zoomLabel(1, { min: 1, max: 15, base: 2, hardware: true })).toBe('0.5')
    expect(zoomLabel(5, { min: 1, max: 15, base: 2, hardware: true })).toBe('2.5')
  })
})

describe('pinchZoom', () => {
  const range = zoomRange(undefined)
  it('zooms by the ratio the fingers moved apart, held inside the range', () => {
    expect(pinchZoom(1, 100, 200, range)).toBe(2)
    expect(pinchZoom(2, 100, 1000, range)).toBe(DIGITAL_MAX)
    expect(pinchZoom(2, 100, 10, range)).toBe(1)
    expect(pinchZoom(2, 0, 50, range)).toBe(2)
  })
})

describe('applyHardwareZoom', () => {
  it('asks the track for the zoom, and a refusal does not throw', async () => {
    const track = aTrack({ min: 1, max: 10 })
    await applyHardwareZoom(track, 3)
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] })
    vi.mocked(track.applyConstraints).mockRejectedValueOnce(new Error('OverconstrainedError'))
    await expect(applyHardwareZoom(track, 4)).resolves.toBeUndefined()
  })
})

describe('cropFrame', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('keeps the middle 1/zoom of the frame, which is what the scaled preview showed', () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const frame = { image: 'f' as unknown as CanvasImageSource, width: 1920, height: 1080, release: vi.fn() }
    const cropped = cropFrame(frame, 2)
    expect([cropped.width, cropped.height]).toEqual([960, 540])
    expect(drawImage).toHaveBeenCalledWith('f', 480, 270, 960, 540, 0, 0, 960, 540)
    expect(frame.release).toHaveBeenCalled()
  })

  it('hands back the frame untouched at 1×', () => {
    const frame = { image: 'f' as unknown as CanvasImageSource, width: 4, height: 3, release: vi.fn() }
    expect(cropFrame(frame, 1)).toBe(frame)
    expect(frame.release).not.toHaveBeenCalled()
  })
})

describe('hardwareZoomer', () => {
  // A pinch fires dozens of touchmoves a second. Asking the camera for each one queues reconfigurations faster
  // than iOS performs them and freezes the page, so one request is in flight at a time and only the newest waits.
  it('keeps one request in flight and sends only the newest zoom after it', async () => {
    const pending: Array<() => void> = []
    const track = { applyConstraints: vi.fn(() => new Promise<void>((r) => pending.push(r))) } as unknown as MediaStreamTrack
    const zoomer = hardwareZoomer(() => track)
    for (const z of [1.1, 1.2, 1.3, 1.4, 1.5]) zoomer.set(z)
    expect(track.applyConstraints).toHaveBeenCalledTimes(1)
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.1 }] })
    pending.shift()!()
    await vi.waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(2))
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.5 }] })
    pending.shift()!()
    await new Promise((r) => setTimeout(r, 0))
    expect(track.applyConstraints).toHaveBeenCalledTimes(2)
  })

  it('carries on after a refusal, and does nothing with no track', async () => {
    const track = { applyConstraints: vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue(undefined) } as unknown as MediaStreamTrack
    const zoomer = hardwareZoomer(() => track)
    zoomer.set(2)
    zoomer.set(3)
    await vi.waitFor(() => expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] }))
    expect(() => hardwareZoomer(() => undefined).set(2)).not.toThrow()
  })
})
