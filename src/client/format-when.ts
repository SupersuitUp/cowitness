// A time as the reader's phone shows it. Computed on the client, because the server does not know
// the phone's zone. Moved from the app Cowitness was built in.
export function formatWhen(at: string, now = new Date()): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric', minute: '2-digit',
  })
}
