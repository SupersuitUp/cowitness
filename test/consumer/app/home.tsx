'use client'

import { CowitnessHome, CowitnessProvider, type ThreadSlotProps } from '@supersuit/cowitness/client'

const Thread = ({ comments }: ThreadSlotProps) => <ul>{(comments ?? []).map((c) => <li key={c.id}>{c.text}</li>)}</ul>

export function Home() {
  return (
    <CowitnessProvider
      config={{
        apiBase: '/api/snaps', pageBase: '/moments', vaultName: 'consumer-recordings',
        uploadUrls: { photo: '/api/photos/upload-url', video: '/api/videos/upload-url' },
        renderThread: (p) => <Thread {...p} />,
      }}
      theme={{ ink: '#222222' }}
    >
      <CowitnessHome rows={[]} streak={[]} witnessed={0} queue={[]} me="a" names={{ a: 'A', b: 'B' }} />
    </CowitnessProvider>
  )
}
