'use client'

// Named exports only: Next.js refuses `export *` inside a client boundary.
export { CowitnessProvider } from './provider.js'
export type { CowitnessClientConfig, ThreadSlotProps } from './config.js'
export { setTheme, DEFAULT_THEME, type ThemeTokens } from './theme.js'
export { CowitnessHome } from './cowitness-home.js'
export { SnapDetail } from './snap-detail.js'
export { SnapsArchive } from './snaps-archive.js'
export { StreakStrip } from './streak-strip.js'
export { AddSnap } from './add-snap.js'
export { WitnessSession } from './witness-session.js'

// The recording pieces an app's other screens may share (a notes screen that records voice can reuse them).
export {
  RECORD_MAX_SEC, AUDIO_BITS_PER_SECOND, MIC_CONSTRAINTS, SESSION_MIC_CONSTRAINTS, pickMimeType, formatClock, nearCap, atCap,
  NOTHING_HEARD_NOTE, voiceFailure, type VoiceStage,
} from './recorder.js'
export { SPEECH_LEVEL, SPEECH_FLOOR_SEC, MAX_FRAME_GAP_MS, startTally, tally, heardSpeech, shouldKeep, type SpeechTally } from './speech.js'
export { newAudioContext, analyserListener, type Listener } from './mic-level.js'
export { levelOf, SOUND_FLOOR, QUIET_SEC, hearing, meterWidth, type Hearing } from './hearing.js'
export {
  VAULT_KEEP_DAYS, newRecordingId, beginRecording, keepChunk, endRecording, forget, audioOf, isEmpty, recoverable, expired,
  describeRecovered, downloadName, indexedDbVault, memoryVault, type VaultRecord, type VaultStore,
} from './recording-vault.js'
export {
  grabAndClose, THUMB_EDGE, frameThumb, cameraConstraints, openStream, playing, browserCamera,
  type Facing, type Frame, type Camera, type Shot, type CameraIo,
} from './dual-camera.js'
