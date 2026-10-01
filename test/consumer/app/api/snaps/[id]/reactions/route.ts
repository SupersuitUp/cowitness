import { createCowitnessHandlers } from '@supersuit/cowitness/server'
import { host } from '../../../../../lib/host'

export const runtime = 'nodejs'
// The transcription runs after the response, inside this function's time.
export const maxDuration = 300
export const { POST } = createCowitnessHandlers(host).reactions
