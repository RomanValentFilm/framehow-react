// HOW LONG TO WAIT BEFORE TRYING AGAIN (#463).
//
// When a save cannot reach the server the work stays on the device and a timer
// tries again. That timer used to be forty seconds, the same forty seconds, for
// ever — so a server that is down for an hour is asked ninety times, each time
// the whole project, each time failing, each time a line in the log.
//
// So the wait grows while nothing is getting through: 40 seconds, 80, 160, and
// then five minutes for as long as it lasts.
//
// TWO THINGS THIS MUST NOT DO, both of them the reason it is a plain function
// here rather than arithmetic buried in the timer:
//
//   1. It must never delay a retry the user can feel. Coming back online, and
//      the connection watch behind it (#298), send IMMEDIATELY and put the
//      count back to nothing. The growing wait belongs to the background timer
//      alone.
//   2. It must never apply when nothing is wrong. The retry already does
//      nothing unless there is work the server has not confirmed, so this only
//      ever slows down a thing that is failing over and over.

/** The wait the retry has always used, and the one it goes back to. */
export const FIRST_RETRY_WAIT_MS = 40_000;

/** However long the trouble lasts, it is asked at least this often. */
export const LONGEST_RETRY_WAIT_MS = 300_000;

/**
 * How long to wait after this many failures in a row.
 *
 *   0 → 40s   (nothing has failed; the ordinary rhythm)
 *   1 → 80s
 *   2 → 160s
 *   3 → 5 min  (320s, held down to the cap)
 *   4+ → 5 min
 */
export function nextRetryWait(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return FIRST_RETRY_WAIT_MS;
  const doubled = FIRST_RETRY_WAIT_MS * 2 ** Math.floor(failures);
  // 2 ** something huge is Infinity, and Math.min holds that at the cap.
  return Math.min(doubled, LONGEST_RETRY_WAIT_MS);
}

/**
 * May the background timer try again yet?
 *
 * `lastTryAt` is null before anything has been attempted at all — a device that
 * has just been opened with unsent work on it must not sit out a wait it never
 * earned.
 */
export function timeToTryAgain(
  now: number, lastTryAt: number | null, failures: number,
): boolean {
  if (lastTryAt === null) return true;
  // A clock that has gone backwards (a device waking, a manual time change)
  // must not lock the retry out for hours. Treat it as "long enough".
  if (now < lastTryAt) return true;
  return now - lastTryAt >= nextRetryWait(failures);
}
