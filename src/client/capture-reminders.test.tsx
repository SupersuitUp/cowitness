import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { CaptureReminders } from './capture-reminders.js'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('CaptureReminders', () => {
  it('shows the person\'s times, snoozes today, and undoes it', async () => {
    fetchMock.mockResolvedValueOnce(ok({ times: ['08:30'], snoozedUntil: '2026-09-30' })).mockResolvedValueOnce(ok({ times: ['08:30'], snoozedUntil: null }))
    render(<CaptureReminders initial={{ times: ['08:30', '19:00'], snoozedUntil: null, today: '2026-09-30' }}><span>switch</span></CaptureReminders>)
    expect(screen.getByText('08:30')).toBeInTheDocument()
    expect(screen.getByText('switch')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not today' })) })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/us/snaps/prompts')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ snoozeToday: true })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ snoozeToday: false })
  })
  it('edits the times, and says so when a save does not land', async () => {
    fetchMock.mockResolvedValueOnce(ok({ times: ['07:00', '20:15'], snoozedUntil: null })).mockResolvedValueOnce(new Response('{}', { status: 400 }))
    render(<CaptureReminders initial={{ times: ['08:30'], snoozedUntil: null, today: '2026-09-30' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit times' }))
    fireEvent.change(screen.getByLabelText('Times'), { target: { value: '07:00, 20:15' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ times: ['07:00', '20:15'] })
    expect(screen.getByText('20:15')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Not today' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('That did not save. Try again.')
  })
  it('a save that does not land keeps the editor open with what was typed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }))
    render(<CaptureReminders initial={{ times: ['08:30'], snoozedUntil: null, today: '2026-09-30' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit times' }))
    fireEvent.change(screen.getByLabelText('Times'), { target: { value: '07:00, 25:99' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(screen.getByLabelText('Times')).toHaveValue('07:00, 25:99')
    expect(screen.getByRole('alert')).toHaveTextContent('That did not save. Try again.')
    expect(screen.getByText('08:30')).toBeInTheDocument()
  })
})
