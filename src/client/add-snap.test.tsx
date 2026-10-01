import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('./snap-upload.js', () => ({ postSnap: vi.fn() }))
vi.mock('./dual-camera.js', () => ({ openStream: vi.fn(async () => ({}) as MediaStream) }))
vi.mock('./snap-camera.js', () => ({
  SnapCamera: ({ onCapture, onPickInstead }: { onCapture(f: File): void; onPickInstead(): void }) => (
    <div>
      <button type="button" onClick={() => onCapture(new File(['c'], 'snap.jpg', { type: 'image/jpeg' }))}>Use it</button>
      <button type="button" onClick={onPickInstead}>Choose a photo instead</button>
    </div>
  ),
}))

import { AddSnap } from './add-snap.js'
import { postSnap } from './snap-upload.js'
import { openStream } from './dual-camera.js'

const pick = (file: File) => fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [file] } })

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('AddSnap', () => {
  it('opens the picker for one photo or video, then a sheet with a caption and Send', async () => {
    render(<AddSnap />)
    const input = screen.getByLabelText('Choose a photo') as HTMLInputElement
    expect(input.multiple).toBe(false)
    expect(input.accept).toBe('image/*')
    expect((screen.getByLabelText('Choose a video') as HTMLInputElement).accept).toBe('video/*')
    pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    expect(screen.getByRole('dialog', { name: 'New snap' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'the view' } })
    vi.mocked(postSnap).mockResolvedValue()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(postSnap).toHaveBeenCalledWith(expect.any(File), 'the view', expect.objectContaining({ composed: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps the sheet and the caption when a send fails, and says so', async () => {
    render(<AddSnap />)
    pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'keep me' } })
    vi.mocked(postSnap).mockRejectedValue(new Error('upload failed'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(screen.getByText('Not sent. Try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('Caption')).toHaveValue('keep me')
  })

  it('Send again after a failed filing files what was already stored, instead of uploading it twice', async () => {
    render(<AddSnap />)
    pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    vi.mocked(postSnap).mockReset()
    vi.mocked(postSnap).mockImplementationOnce(async (_f, _c, opts) => { opts?.onSent?.({ kind: 'photo', photoId: 'p1' }); throw new Error('filing lost') })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    vi.mocked(postSnap).mockResolvedValueOnce()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(vi.mocked(postSnap).mock.calls[1][2]).toMatchObject({ sent: { kind: 'photo', photoId: 'p1' } })
  })

  it('a different pick starts clean, with nothing stored to reuse', async () => {
    render(<AddSnap />)
    pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    vi.mocked(postSnap).mockReset()
    vi.mocked(postSnap).mockImplementationOnce(async (_f, _c, opts) => { opts?.onSent?.({ kind: 'photo', photoId: 'p1' }); throw new Error('filing lost') })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    pick(new File(['y'], 'b.jpg', { type: 'image/jpeg' }))
    vi.mocked(postSnap).mockResolvedValueOnce()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(vi.mocked(postSnap).mock.calls[1][2]?.sent).toBeUndefined()
  })

  it('asks for the back camera inside the tap, and sends what the camera composed', async () => {
    render(<AddSnap />)
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Double camera photo' }))
    expect(openStream).toHaveBeenCalledWith('user')
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }))
    expect(screen.getByRole('dialog', { name: 'New snap' })).toBeInTheDocument()
    vi.mocked(postSnap).mockResolvedValue()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(postSnap).toHaveBeenCalledWith(expect.any(File), '', expect.objectContaining({ composed: true }))
  })

  it('falls back to the library when there is no camera to open', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<AddSnap />)
    fireEvent.click(screen.getByRole('button', { name: 'Double camera photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo instead' }))
    expect(click).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Choose a photo instead' })).toBeNull()
    click.mockRestore()
  })
})
