// Streaks: how many days in a row someone has shared a snap, from `@supersuit/streak-steward`.
// This file is a pointer, not a copy. Cowitness shipped its own implementation of every one of
// these, which is why one day-counting bug existed twice: the package learned to count in a named
// zone and the copy here kept counting in the phone's own calendar day, so a phone an hour east of
// the zone the streak is kept in read an 11pm snap as the next day, opened a gap on every day its
// owner shared only late, and collapsed both their streak and the together streak.
//
// `streakOf` and `streaksOf` still count the device's day, for an app whose day IS the phone's.
// `zonedStreakOf` and `zonedStreaksOf` count in named zones, one for everyone or one per member,
// and read a day as generously as those zones allow: a time counts toward its day key in EVERY
// zone in play, a member's days are the union of those keys, and a together day is the
// intersection of the members' unions. Two people an hour apart then keep the evening they shared.
export {
  streakOf, streaksOf, zonedStreakOf, zonedStreaksOf, zonesOf, captureStreak, householdStreakOf,
  type Streak, type Streaks, type StreakRow, type StreakZones, type HouseholdStreak,
} from '@supersuit/streak-steward'
