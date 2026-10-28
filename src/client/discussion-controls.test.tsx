import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiscussionInput, DiscussionSend, EmojiFreePick, EmojiReactions, readDiscussionDraft, writeDiscussionDraft, clearDiscussionDraft } from './discussion-controls.js'
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
  it('shows an emoji someone picked outside the six, so everyone can see and tap it', () => {
    const toggle = vi.fn()
    render(<EmojiReactions me="reader" names={{ writer: 'Writer' }} marks={[{ by: 'writer', emoji: '🦄' }]} onToggle={toggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add 🦄' })); expect(toggle).toHaveBeenCalledWith('🦄', true)
    expect(screen.queryByRole('button', { name: 'Add any emoji' })).toBeNull()
    cleanup()
    render(<EmojiReactions me="reader" names={{ writer: 'Writer' }} marks={[{ by: 'writer', emoji: '🦄' }]} existingOnly onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: '🦄 · Writer' })).toBeInTheDocument()
  })
  it('anyEmoji opens a free pick that sends one emoji and ignores words', () => {
    const toggle = vi.fn()
    render(<EmojiReactions me="reader" names={{}} marks={[]} anyEmoji onToggle={toggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add any emoji' }))
    const field = screen.getByRole('textbox', { name: 'Pick any emoji' })
    fireEvent.change(field, { target: { value: 'hi' } }); expect(toggle).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: 'hi🫶🏽' } }); expect(toggle).toHaveBeenCalledWith('🫶🏽', true)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('EmojiFreePick stands alone for a host with its own reaction row, and Escape closes it', () => {
    const pick = vi.fn()
    render(<EmojiFreePick onPick={pick} label="React with any emoji" />)
    fireEvent.click(screen.getByRole('button', { name: 'React with any emoji' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Pick any emoji' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'React with any emoji' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Pick any emoji' }), { target: { value: '🇪🇹' } })
    expect(pick).toHaveBeenCalledWith('🇪🇹')
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
