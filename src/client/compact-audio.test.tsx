import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { CompactAudio } from './compact-audio.js'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('compact optional audio playback', () => {
  it('plays and pauses through labeled custom controls without a native audio bar', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { container } = render(<CompactAudio src="/clip" label="Voice from Reader" durationSec={9} />)
    expect(container.querySelector('audio')).not.toHaveAttribute('controls')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play Voice from Reader' })) })
    expect(play).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause Voice from Reader' })); expect(pause).toHaveBeenCalled()
    expect(screen.getByRole('slider', { name: 'Position in Voice from Reader' })).toBeInTheDocument()
  })
  it('reports a refused playback without claiming it is playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('no'))
    render(<CompactAudio src="/clip" label="Voice" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play Voice' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not play')
    expect(screen.getByRole('button', { name: 'Play Voice' })).toBeInTheDocument()
  })
})
