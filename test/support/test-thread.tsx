import { useState } from 'react'
import type { ThreadSlotProps } from '../../src/client/config.js'
import type { Comment } from '../../src/types.js'

export function TestThread({ snapId, me, names, comments, onSent, audioSrc, onRetranscribe }: ThreadSlotProps) {
  const [text, setText] = useState('')
  const send = async () => {
    const res = await fetch(`/api/us/snaps/${snapId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'comment', text }),
    })
    if (res.ok) onSent(((await res.json()) as { comments?: Comment[] }).comments ?? [])
  }
  return (
    <section aria-label="Conversation">
      {(comments ?? []).map((c) => (
        <div key={c.id}>
          {c.text && <p>{c.text}</p>}
          {audioSrc(c) && <audio aria-label={`Voice message from ${names[c.by]}`} src={audioSrc(c) ?? undefined} />}
          {c.recording?.status === 'transcribing' && <span>Transcribing</span>}
          {c.recording?.status === 'failed' && (
            <>
              <p>{`Could not be transcribed${c.recording.reason ? `: ${c.recording.reason}` : ''}. The voice is still here.`}</p>
              <button type="button" onClick={() => onRetranscribe(c.id)}>Try again</button>
            </>
          )}
        </div>
      ))}
      <textarea
        aria-label={`Message as ${names[me]}`}
        placeholder={(comments?.length ?? 0) > 0 ? 'Reply' : 'Say something'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" onClick={() => { void send() }}>Send</button>
    </section>
  )
}
