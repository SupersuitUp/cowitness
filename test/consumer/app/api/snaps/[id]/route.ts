import { createCowitnessHandlers } from '@supersuit/cowitness/server'
import { host } from '../../../../lib/host'

export const runtime = 'nodejs'
export const { GET, PATCH } = createCowitnessHandlers(host).snap
