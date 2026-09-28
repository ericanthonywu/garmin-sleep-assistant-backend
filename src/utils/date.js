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
 * Shifts a 'YYYY-MM-DD' date string by N days (negative = past).
 */
export function shiftDate(dateStr, days) {
  return moment.tz(dateStr, env.TIMEZONE).add(days, 'days').format('YYYY-MM-DD');
}

/**
 * Normalizes an 'HH:MM' string, ISO timestamp, or Date to a local 'HH:MM' string in user's timezone.
 */
export function toLocalHHMM(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) return value;
  const m = moment(value);
  return m.isValid() ? m.tz(env.TIMEZONE).format('HH:mm') : null;
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
 * Formats a Date object or date string to YYYY-MM-DD in user's timezone.
 */
export function formatDateKey(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    return dateVal.split('T')[0];
  }
  return moment(dateVal).tz(env.TIMEZONE).format('YYYY-MM-DD');
}

