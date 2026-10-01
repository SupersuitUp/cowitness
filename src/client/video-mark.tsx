import { formatDuration } from './format-duration.js'
import { INK } from './theme.js'

// INK at 90%: the tile a video shows when there is no poster frame to draw.
// A function, because INK is the app's and is only known once the app has set it.
export const noPosterBg = () => `${INK}e6`

/** The dark stand-in for a video with no poster. Fills its (relative) parent. */
export function NoPoster() {
  return <div data-testid="video-no-poster" className="absolute inset-0" style={{ backgroundColor: noPosterBg() }} />
}

// What marks a tile as a video: a play glyph in the middle and the length in the
// bottom-right corner. Decorative; the tile's own label says it is a video.
export function VideoMark({ durationSec, small = false }: { durationSec?: number; small?: boolean }) {
  const disc = small ? 'h-7 w-7' : 'h-9 w-9'
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          data-testid="play-glyph"
          className={`flex ${disc} items-center justify-center rounded-full`}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.38)' }}
        >
          <svg viewBox="0 0 24 24" width={small ? 12 : 16} height={small ? 12 : 16}>
            <path d="M8 5.5v13l10.5-6.5z" fill="#fff" />
          </svg>
        </span>
      </span>
      {durationSec !== undefined && durationSec > 0 && (
        <span
          className="absolute right-1 bottom-1 rounded px-1 text-[11px] leading-4 font-medium tabular-nums text-white"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
        >
          {formatDuration(durationSec)}
        </span>
      )}
    </span>
  )
}
