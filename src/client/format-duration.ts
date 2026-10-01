// A video's length the way Photos shows it: m:ss under an hour, h:mm:ss after. Moved from the app
// Cowitness was built in.
export function formatDuration(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
