// Calendar arithmetic on day keys (YYYY-MM-DD) in one named time zone, from
// `@supersuit/streak-steward`. This file is a pointer, not a copy: every one of these used to be
// implemented here as well as there, and a day-counting bug then had to be fixed twice. It was
// fixed once, in the package, and the copy here went on filing a late-evening snap on the next
// day for anyone whose phone sat east of the zone the streak is kept in.
export {
  DAY_MS, zoned, addDays, daysBetween, weekStart, minutesOf, inWindow, localDayKey, msUntilMidnight,
} from '@supersuit/streak-steward'
