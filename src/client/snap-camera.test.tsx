import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('./dual-camera.js', async (orig) => ({
  ...(await orig<typeof import('./dual-camera.js')>()),
  grabAndClose: vi.fn(),
  frameThumb: vi.fn(),
  openStream: vi.fn(),
  playing: vi.fn((stream: MediaStream, video: HTMLVideoElement) => ({ stream, video })),
  browserCamera: { open: vi.fn(), grab: vi.fn(), close: vi.fn() },
}))
vi.mock('./snap-compose.js', () => ({
  drawCameras: vi.fn(), drawWithScreen: vi.fn(), encodeSnap: vi.fn(),
  previewUrl: vi.fn(), freeCanvas: vi.fn(), frameFrom: vi.fn(), snapFile: vi.fn(),
}))

vi.mock('./upright.js', async (orig) => ({
  ...(await orig<typeof import('./upright.js')>()),
  readTilt: vi.fn(() => null),
  screenAngle: vi.fn(() => 0),
  turnFrame: vi.fn((f: unknown, turns: number) => ({ ...(f as object), turned: turns })),
}))

import { SnapCamera } from './snap-camera.js'
import { readTilt, screenAngle, turnFrame } from './upright.js'
import { browserCamera, frameThumb, grabAndClose, openStream } from './dual-camera.js'
import { drawCameras, drawWithScreen, encodeSnap, frameFrom, freeCanvas, previewUrl, snapFile } from './snap-compose.js'

const aStream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream
const aFrame = (name: string) => ({ image: name as unknown as CanvasImageSource, width: 4, height: 3, release: vi.fn() })
const composed = new File(['j'], 'snap.jpg', { type: 'image/jpeg' })
const cameraCanvas = { id: 'cameras' } as unknown as HTMLCanvasElement
const panelCanvas = { id: 'panels' } as unknown as HTMLCanvasElement

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:snap')
  URL.revokeObjectURL = vi.fn()
  vi.mocked(grabAndClose).mockImplementation(async () => aFrame('grabbed'))
  vi.mocked(frameThumb).mockReturnValue('data:image/jpeg;base64,thumb')
  vi.mocked(drawCameras).mockReturnValue(cameraCanvas)
  vi.mocked(drawWithScreen).mockReturnValue(panelCanvas)
  vi.mocked(encodeSnap).mockResolvedValue(new Blob(['j'], { type: 'image/jpeg' }))
  vi.mocked(previewUrl).mockImplementation((c) => (c === panelCanvas ? 'data:panels' : 'data:cameras'))
  vi.mocked(snapFile).mockReturnValue(composed)
  vi.mocked(frameFrom).mockImplementation(async () => aFrame('screenshot'))
  vi.mocked(openStream).mockResolvedValue(aStream())
})

const props = () => ({ onCapture: vi.fn(), onClose: vi.fn(), onPickInstead: vi.fn() })
const open = async (p = props()) => {
  await act(async () => { render(<SnapCamera stream={Promise.resolve(aStream())} {...p} />) })
  return p
}
const press = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('SnapCamera', () => {
  it('turns each frame upright by how the phone is held at the shutter, each camera its own way', async () => {
    vi.mocked(readTilt).mockReturnValue({ beta: 0, gamma: -89 }) // right edge up: landscape
    vi.mocked(turnFrame).mockClear()
    await open()
    await press('Take the selfie')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take the snap' })).not.toBeDisabled())
    await press('Take the snap')
    expect(vi.mocked(turnFrame).mock.calls.map((c) => c[1])).toEqual([1, 3])
    const shot = vi.mocked(drawCameras).mock.calls.at(-1)![0] as unknown as { back: { turned: number }; front: { turned: number } }
    expect(shot.back.turned).toBe(3)
    expect(shot.front.turned).toBe(1)
    // The preview is shown whole, so a landscape snap is not cropped back to portrait.
    expect(screen.getByAltText('The snap you just took').className).toContain('object-contain')
    vi.mocked(readTilt).mockReturnValue(null)
  })

  it('shows a sideways selfie in a sideways corner while the photo is framed', async () => {
    vi.mocked(grabAndClose).mockImplementationOnce(async () => ({ ...aFrame('selfie'), width: 1280, height: 720 }))
    await open()
    await press('Take the selfie')
    expect(screen.getByAltText('The selfie you just took').style.aspectRatio).toBe('4 / 3')
  })

  it('leaves the frames alone when the page has turned with the phone', async () => {
    vi.mocked(readTilt).mockReturnValue({ beta: 0, gamma: -89 })
    vi.mocked(screenAngle).mockReturnValue(90)
    vi.mocked(turnFrame).mockClear()
    await open()
    await press('Take the selfie')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take the snap' })).not.toBeDisabled())
    await press('Take the snap')
    expect(vi.mocked(turnFrame).mock.calls.map((c) => c[1])).toEqual([0, 0])
    vi.mocked(readTilt).mockReturnValue(null)
    vi.mocked(screenAngle).mockReturnValue(0)
  })

  it('opens on the selfie, mirrored, because the front camera is the only one running', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'Take the selfie' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take the snap' })).toBeNull()
    expect(document.querySelector('video')?.className).toContain('-scale-x-100')
  })

  it('takes the selfie first, then opens the back camera with that selfie in the corner', async () => {
    await open()
    await press('Take the selfie')
    expect(openStream).toHaveBeenCalledWith('environment')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take the snap' })).toBeInTheDocument())
    expect(screen.getByAltText('The selfie you just took')).toHaveAttribute('src', 'data:image/jpeg;base64,thumb')
    expect(document.querySelector('video')?.className).not.toContain('-scale-x-100')
  })

  it('composes both frames on the second press and offers the result before it is sent', async () => {
    const p = await open()
    await press('Take the selfie')
    await waitFor(() => screen.getByRole('button', { name: 'Take the snap' }))
    await press('Take the snap')
    expect(grabAndClose).toHaveBeenCalledTimes(2)
    expect(vi.mocked(drawCameras).mock.calls[0][0]).toEqual(
      expect.objectContaining({ back: expect.anything(), front: expect.anything() }),
    )
    // Nothing is encoded while the person is still deciding.
    expect(encodeSnap).not.toHaveBeenCalled()
    expect(p.onCapture).not.toHaveBeenCalled()
    await press('Use it')
    expect(encodeSnap).toHaveBeenCalledTimes(1)
    expect(encodeSnap).toHaveBeenCalledWith(cameraCanvas)
    expect(p.onCapture).toHaveBeenCalledWith(composed)
  })

  it('cannot be fired twice while a frame is being taken', async () => {
    let finish: (f: ReturnType<typeof aFrame>) => void = () => {}
    vi.mocked(grabAndClose).mockReturnValue(new Promise((r) => { finish = r }))
    await open()
    const shutter = screen.getByRole('button', { name: 'Take the selfie' })
    await act(async () => { fireEvent.click(shutter) })
    fireEvent.click(shutter)
    expect(grabAndClose).toHaveBeenCalledTimes(1)
    await act(async () => { finish(aFrame('late')) })
  })

  it('Retake starts over from the selfie', async () => {
    await open()
    await press('Take the selfie')
    await waitFor(() => screen.getByRole('button', { name: 'Take the snap' }))
    await press('Take the snap')
    await press('Retake')
    expect(freeCanvas).toHaveBeenCalledWith(cameraCanvas)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take the selfie' })).toBeInTheDocument())
    expect(openStream).toHaveBeenLastCalledWith('user')
  })

  it('offers the picker when there is no camera to open', async () => {
    const p = props()
    await act(async () => { render(<SnapCamera stream={Promise.reject(new Error('denied'))} {...p} />) })
    await waitFor(() => expect(screen.getByText('No camera.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo instead' }))
    expect(p.onPickInstead).toHaveBeenCalled()
  })

  it('lets the camera go when it closes', async () => {
    const p = await open()
    await press('Close')
    expect(browserCamera.close).toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('offers a screenshot after the two shots, and lays it in beside them when one is chosen', async () => {
    await open()
    await press('Take the selfie')
    await waitFor(() => screen.getByRole('button', { name: 'Take the snap' }))
    await press('Take the snap')
    expect(screen.getByRole('button', { name: 'Add a screenshot' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose a screenshot'), {
        target: { files: [new File(['s'], 'shot.png', { type: 'image/png' })] },
      })
    })
    // The camera CANVAS is what the screenshot is laid beside, so those pixels reach the encoder
    // having been through no encoder at all.
    expect(drawWithScreen).toHaveBeenCalledWith(cameraCanvas, expect.objectContaining({ image: 'screenshot' }))
    expect(freeCanvas).toHaveBeenCalledWith(cameraCanvas)
    expect(encodeSnap).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add a screenshot' })).toBeNull())
    expect(screen.getByAltText('The snap you just took')).toHaveAttribute('src', 'data:panels')
    await press('Use it')
    expect(encodeSnap).toHaveBeenCalledTimes(1)
    expect(encodeSnap).toHaveBeenCalledWith(panelCanvas)
  })

  it('sends the two-camera snap when no screenshot is added', async () => {
    const p = await open()
    await press('Take the selfie')
    await waitFor(() => screen.getByRole('button', { name: 'Take the snap' }))
    await press('Take the snap')
    await press('Use it')
    expect(drawWithScreen).not.toHaveBeenCalled()
    expect(encodeSnap).toHaveBeenCalledTimes(1)
    expect(p.onCapture).toHaveBeenCalledWith(composed)
  })

  it('says what the three steps are from the start, so the screenshot is not a thing to discover', async () => {
    await open()
    expect(screen.getByText('Selfie')).toBeInTheDocument()
    expect(screen.getByText('Photo')).toBeInTheDocument()
    expect(screen.getByText('Screenshot')).toBeInTheDocument()
    expect(screen.getByText('Selfie')).toHaveAttribute('aria-current', 'step')

    await press('Take the selfie')
    await waitFor(() => expect(screen.getByText('Photo')).toHaveAttribute('aria-current', 'step'))
    await press('Take the snap')
    expect(screen.getByText('Screenshot')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Selfie')).not.toHaveAttribute('aria-current')
  })
})
