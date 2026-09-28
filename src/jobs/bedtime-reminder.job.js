import cron from 'node-cron';
import moment from 'moment-timezone';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { NotificationService } from '../services/notification.service.js';
import { env } from '../config/env.js';

const NUDGE_WINDOW_MINUTES = 15;
const LATE_REPEAT_MINUTES = 15;
const LATE_REMINDER_DURATION_MINUTES = 90;

const sentNudges = new Set();
let sentNudgesNight = null;

/**
 * Returns the nudge due at `nowMinutes` (minutes past noon), or null.
 * Sequence: dim lights -> wind down -> bedtime -> cutoff, then a silent "still awake?"
 * every 15 min for 90 min after the cutoff. All times come from tonight's plan.
 *
 * @returns {{ kind: 'dim'|'winddown'|'bedtime'|'cutoff'|'late', key: string } | null}
 */
export function resolveDueNudge(rec, nowMinutes) {
  if (!rec?.latestBedtimeCutoff) return null;
  const toMins = SleepEngineService.timeToMinutesPastNoon;
  const sinceTime = (time) => SleepEngineService.circularDiff(nowMinutes, toMins(time));

  const sinceCutoff = sinceTime(rec.latestBedtimeCutoff);
  if (sinceCutoff >= NUDGE_WINDOW_MINUTES && sinceCutoff < NUDGE_WINDOW_MINUTES + LATE_REMINDER_DURATION_MINUTES) {
    const slot = Math.floor((sinceCutoff - NUDGE_WINDOW_MINUTES) / LATE_REPEAT_MINUTES);
    return { kind: 'late', key: `late-${slot}` };
  }

  const schedule = [
    ['cutoff', rec.latestBedtimeCutoff],
    ['bedtime', rec.recommendedBedtime],
    ['winddown', rec.windDownStart],
    ['dim', rec.dimLightsStart],
  ];
  for (const [kind, time] of schedule) {
    if (!time) continue;
    const since = sinceTime(time);
    if (since >= 0 && since < NUDGE_WINDOW_MINUTES) return { kind, key: kind };
  }
  return null;
}

async function checkBedtimeNudges() {
  const now = moment().tz(env.TIMEZONE);
  // A "night" runs noon -> noon so nudges after midnight belong to the same night.
  const night = (now.hour() < 12 ? now.clone().subtract(1, 'day') : now).format('YYYY-MM-DD');
  if (night !== sentNudgesNight) {
    sentNudges.clear();
    sentNudgesNight = night;
  }

  const rec = await SleepEngineService.getRecommendation(night);
  const currentTimeStr = now.format('HH:mm');
  const due = resolveDueNudge(rec, SleepEngineService.timeToMinutesPastNoon(currentTimeStr));
  if (!due || sentNudges.has(due.key)) return;

  sentNudges.add(due.key);
  console.log(`[bedtime-reminder] Sending ${due.kind} nudge at ${currentTimeStr} (bedtime ${rec.recommendedBedtime}, cutoff ${rec.latestBedtimeCutoff})`);
  await NotificationService.sendBedtimeReminder({ kind: due.kind, rec, currentTimeStr });
}

/**
 * Checks every 5 minutes and sends each of tonight's silent nudges once.
 */
export function startBedtimeReminderJob() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkBedtimeNudges();
    } catch (err) {
      console.error('[bedtime-reminder] Error checking bedtime reminder schedule:', err.message);
    }
  }, {
    timezone: env.TIMEZONE,
  });

  console.log(`⏰ Bedtime reminder job active: dim-lights, wind-down, bedtime and cutoff nudges (${env.TIMEZONE})`);
}
