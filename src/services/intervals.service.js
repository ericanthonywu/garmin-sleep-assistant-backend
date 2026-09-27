import { env } from '../config/env.js';

const BASE_URL = `https://intervals.icu/api/v1/athlete/${env.INTERVALS_ATHLETE_ID}`;

function authHeader() {
  return `Basic ${Buffer.from(`API_KEY:${env.INTERVALS_API_KEY}`).toString('base64')}`;
}

export class IntervalsService {
  /**
   * Fetch daily wellness data for a date range from Intervals.icu.
   * @param {string} oldest - YYYY-MM-DD
   * @param {string} newest - YYYY-MM-DD
   */
  static async fetchWellness(oldest, newest) {
    if (!env.INTERVALS_API_KEY || !env.INTERVALS_ATHLETE_ID) {
      console.warn('[IntervalsService] Missing INTERVALS_API_KEY or INTERVALS_ATHLETE_ID. Skipping fetch.');
      return [];
    }

    const url = `${BASE_URL}/wellness?oldest=${oldest}&newest=${newest}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Intervals.icu wellness fetch failed (${res.status}): ${errText}`);
    }

    return res.json();
  }

  /**
   * Fetch activities/workouts from Intervals.icu.
   * @param {string} oldest - YYYY-MM-DD
   * @param {string} newest - YYYY-MM-DD
   */
  static async fetchActivities(oldest, newest) {
    if (!env.INTERVALS_API_KEY || !env.INTERVALS_ATHLETE_ID) {
      return [];
    }

    const url = `${BASE_URL}/activities?oldest=${oldest}&newest=${newest}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Intervals.icu activities fetch failed (${res.status}): ${errText}`);
    }

    return res.json();
  }
}
