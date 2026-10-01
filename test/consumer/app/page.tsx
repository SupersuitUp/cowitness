import { streaksOf } from '@supersuit/cowitness'
import { Home } from './home'
import { Options } from './options'

export const dynamic = 'force-dynamic'

// A server component using the plain entry, rendering the client screens beneath it: the default
// screens, then the same screens with every option on.
export default function Page() {
  const s = streaksOf([], new Date(), ['a', 'b'])
  return <main><p>{s.together.count} days together</p><Home /><Options /></main>
}
