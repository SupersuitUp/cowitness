import { describe, expect, it } from 'vitest'
import { appendCommentOnce, setEmojiReaction } from './discussion.js'

describe('shared discussion rules with different host anchors', () => {
  it('retries one comment without changing its attribution, words or anchor', () => {
    const c = { id: 'request1', by: 'a', text: 'hello', at: 'first', passage: { turn: 2 } }
    const same = (a: typeof c, b: typeof c) => a.passage.turn === b.passage.turn
    const first = appendCommentOnce([], c, same)
    expect(first.changed).toBe(true)
    expect(appendCommentOnce(first.comments, { ...c, at: 'retry' }, same).changed).toBe(false)
    for (const bad of [{ ...c, by: 'b' }, { ...c, text: 'changed' }, { ...c, passage: { turn: 3 } }]) {
      expect(() => appendCommentOnce(first.comments, bad, same)).toThrow(/request/)
    }
  })
  it('works with whole-item comments that carry no passage', () => {
    const c = { id: 'request1', by: 'reader', text: 'yes', at: 'first' }
    expect(appendCommentOnce([], c).comments).toEqual([c])
  })
  it('keeps other people and other anchors when an emoji is removed', () => {
    const mark = { by: 'a', emoji: '❤️', target: 'chapter-2', at: 'first' }
    const other = { ...mark, by: 'b' }; const elsewhere = { ...mark, target: 'chapter-3' }
    const same = (a: typeof mark, b: typeof mark) => a.target === b.target
    const all = [mark, other, elsewhere]
    expect(setEmojiReaction(all, { ...mark, at: 'retry' }, true, same).changed).toBe(false)
    expect(setEmojiReaction(all, mark, false, same).reactions).toEqual([other, elsewhere])
    expect(setEmojiReaction([], mark, false, same).changed).toBe(false)
    expect(setEmojiReaction([], mark, true, same).reactions).toEqual([mark])
  })
})
