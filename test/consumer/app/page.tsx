import { streaksOf } from '@supersuit/cowitness'
import { Home } from './home'

export const dynamic = 'force-dynamic'

// A server component using the plain entry, rendering the client screens beneath it.
export default function Page() {
  const s = streaksOf([], new Date(), ['a', 'b'])
  return <main><p>{s.together.count} days together</p><Home /></main>
}
