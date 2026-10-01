'use client'

import { CaptureReminders, CowitnessHome, CowitnessProvider, VoiceNote, type ThreadSlotProps } from '@supersuit/cowitness/client'
import { OPTIONS } from '../lib/options-features'

const Thread = ({ comments }: ThreadSlotProps) => <ul>{(comments ?? []).map((c) => <li key={c.id}>{c.text}</li>)}</ul>

// The screens with every option on, given the same options as the host.
export function Options() {
  return (
    <CowitnessProvider
      config={{
        apiBase: '/api/moments', pageBase: '/moments', vaultName: 'consumer-options-recordings',
        uploadUrls: { photo: '/api/photos/upload-url', video: '/api/videos/upload-url' },
        renderThread: (p) => <Thread {...p} />,
        features: OPTIONS,
      }}
      theme={{ ink: '#222222' }}
    >
      <CowitnessHome
        rows={[]} streak={[]} witnessed={0} queue={[]} me="c" names={{ a: 'A', b: 'B', c: 'C' }}
        can={{ share: false, witness: true }} tagChoices={[{ id: 't-first', label: 'First' }]} languages={['en', 'fr']}
      />
      <CaptureReminders initial={{ times: ['09:00'], snoozedUntil: null, today: '2026-10-01' }}>
        <label><input type="checkbox" /> Notifications</label>
      </CaptureReminders>
      <VoiceNote onRecorded={() => {}} />
    </CowitnessProvider>
  )
}
