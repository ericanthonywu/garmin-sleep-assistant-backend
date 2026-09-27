import moment from 'moment-timezone';
import { env } from '../config/env.js';

/**
 * Returns today's date in YYYY-MM-DD format in user's timezone (default Asia/Jakarta).
 */
export function todayStr() {
  return moment().tz(env.TIMEZONE).format('YYYY-MM-DD');
}

/**
 * Returns date N days ago in YYYY-MM-DD format.
 */
export function daysAgo(n) {
  return moment().tz(env.TIMEZONE).subtract(n, 'days').format('YYYY-MM-DD');
}

/**
 * Returns current timestamp in ISO format with timezone.
 */
export function nowIso() {
  return moment().tz(env.TIMEZONE).toISOString();
}

/**
 * Formats seconds into "Xh Ym" string.
 */
export function formatDuration(secs) {
  if (!secs || secs <= 0) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * Check if a date string 'YYYY-MM-DD' falls on a weekend (Saturday or Sunday) in user's timezone.
 */
export function isWeekend(dateStr) {
  const day = moment.tz(dateStr, env.TIMEZONE).day();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Parses time string HH:mm to hour integer (0-23).
 */
export function parseHour(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10);
}
