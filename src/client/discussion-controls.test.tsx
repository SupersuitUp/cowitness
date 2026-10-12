import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiscussionInput, DiscussionSend, EmojiReactions, readDiscussionDraft, writeDiscussionDraft, clearDiscussionDraft } from './discussion-controls.js'
import { afterEach } from 'vitest'
afterEach(cleanup)

describe('portable discussion controls', () => {
  it('exposes names, pressed state and 44px touch targets for any host member keys', () => {
    const toggle = vi.fn()
    render(<EmojiReactions me="reader" names={{ reader: 'Reader', writer: 'Writer' }} marks={[{ by: 'reader', emoji: '❤️' }, { by: 'writer', emoji: '❤️' }]} onToggle={toggle} />)
    const heart = screen.getByRole('button', { name: 'Remove ❤️' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    expect(heart.style.minHeight).toBe('44px')
    fireEvent.click(heart); expect(toggle).toHaveBeenCalledWith('❤️', false)
  })
  it('existing-only mode shows the people on each mark and hides unused emojis', () => {
    render(<EmojiReactions me="reader" names={{ writer: 'Writer' }} marks={[{ by: 'writer', emoji: '🥹' }]} existingOnly onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: '🥹 · Writer' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
  it('preserves host input labels, styles and send rules', () => {
    const change = vi.fn(); const send = vi.fn()
    render(<><DiscussionInput aria-label="Reply" value="" onChange={change} /><DiscussionSend busy canSend onSend={send} /></>)
    expect(screen.getByRole('textbox').style.fontSize).toBe('17px')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } }); expect(change).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled()
  })
  it('holds a draft and never clears newer words for an older successful send', () => {
    writeDiscussionDraft('item-a', 'old'); expect(readDiscussionDraft('item-a')).toBe('old')
    writeDiscussionDraft('item-a', 'new'); clearDiscussionDraft('item-a', 'old')
    expect(readDiscussionDraft('item-a')).toBe('new')
    clearDiscussionDraft('item-a', 'new'); expect(readDiscussionDraft('item-a')).toBeNull()
  })
})
