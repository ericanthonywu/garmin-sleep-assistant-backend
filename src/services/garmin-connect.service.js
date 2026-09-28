import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { BedtimeRepo } from '../repositories/bedtime.repo.js';
import { WellnessRepo } from '../repositories/wellness.repo.js';
import { SleepRepo } from '../repositories/sleep.repo.js';
import { HeartRateRepo } from '../repositories/heartrate.repo.js';
import { SleepEngineService } from './sleep-engine.service.js';
import { isWeekend, todayStr, daysAgo } from '../utils/date.js';

const execFileAsync = promisify(execFile);
const GARMIN_SLEEP_STATS_URL = 'https://connect.garmin.com/gc-api/sleep-service/stats/sleep/daily';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

let lastSyncTimestamp = 0;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown between full Garmin SSO calls

export class GarminConnectService {
  /**
   * Fetches sleep statistics from Garmin Connect.
   * Priority:
   * 1. Python OAuth sync (persistent tokens in .garmin_tokens)
   * 2. Web session cookies & CSRF token (if present)
   * 3. Local cached garmin_scraped_sleep.json
   */
  static async fetchSleepStats(startDate, endDate, options = {}) {
    const cachePath = path.resolve(process.cwd(), 'garmin_scraped_sleep.json');
    const pythonScript = path.resolve(process.cwd(), 'src/scripts/garmin_sync.py');

    // 1. Try Python OAuth-based sync (preferred, zero manual cookie)
    if (fs.existsSync(pythonScript)) {
      try {
        await execFileAsync('python3', [
          pythonScript,
          '--start', startDate,
          '--end', endDate,
          '--out', cachePath,
        ]);

        if (fs.existsSync(cachePath)) {
          const raw = await fs.promises.readFile(cachePath, 'utf8');
          const data = JSON.parse(raw);
          if (data && Array.isArray(data.individualStats) && data.individualStats.length > 0) {
            return data;
          }
        }
      } catch (pyErr) {
        console.warn('[GarminConnectService] Python OAuth sync warning:', pyErr.message);
      }
    }

    // 2. Fall back to direct HTTP request with web cookie if provided
    const csrfToken = options.csrfToken || env.GARMIN_CONNECT_CSRF_TOKEN;
    const cookie = options.cookie || env.GARMIN_CONNECT_COOKIE;

    if (cookie && csrfToken) {
      const url = `${GARMIN_SLEEP_STATS_URL}/${startDate}/${endDate}`;
      const headers = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'connect-csrf-token': csrfToken,
        'cookie': cookie,
        'user-agent': DEFAULT_USER_AGENT,
        'sec-ch-ua': '"Not A(Brand";v="99", "Chromium";v="154"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      };

      const res = await fetch(url, { headers });

      if (res.ok) {
        const data = await res.json();
        try {
          await fs.promises.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (writeErr) {
          console.warn('[GarminConnectService] Cache save warning:', writeErr.message);
        }
        return data;
      }
    }

    // 3. Fall back to cached JSON if exists
    if (fs.existsSync(cachePath)) {
      console.warn('[GarminConnectService] Using cached garmin_scraped_sleep.json');
      const raw = await fs.promises.readFile(cachePath, 'utf8');
      return JSON.parse(raw);
    }

    throw new Error('Unable to fetch sleep data from Garmin Connect (OAuth sync failed and no valid cookies/cache).');
  }

  /**
   * Imports an individualStats array from Garmin Connect JSON into PostgreSQL.
   * @param {object} data - Garmin Connect response JSON
   * @returns {Promise<number>} Number of days imported
   */
  static async importSleepData(data) {
    if (!data || !Array.isArray(data.individualStats)) {
      return 0;
    }

    let count = 0;

    for (const item of data.individualStats) {
      const date = item.calendarDate;
      const v = item.values;
      if (!date || !v) continue;

      // Skip days where watch recorded no sleep
      if (!v.totalSleepTimeInSeconds && !v.localSleepStartTimeInMillis) {
        continue;
      }

      // Convert Garmin local millis to 24h HH:mm string (UTC representation corresponds to local clock)
      const formatLocalHHMM = (millis) => {
        if (!millis) return null;
        return new Date(millis).toISOString().substring(11, 16);
      };

      const bedtime = formatLocalHHMM(v.localSleepStartTimeInMillis);
      const wakeTime = formatLocalHHMM(v.localSleepEndTimeInMillis);
      const sleepHours = v.totalSleepTimeInSeconds != null
        ? Number((v.totalSleepTimeInSeconds / 3600).toFixed(1))
        : null;

      // 1. Upsert bedtime_log
      await BedtimeRepo.upsertLog({
        date,
        bedtime,
        wake_time: wakeTime,
        is_weekend: isWeekend(date),
        sleep_hours: sleepHours,
        sleep_need_mins: v.sleepNeed != null ? Math.round(v.sleepNeed) : null,
      });

      // 2. Upsert daily_wellness (includes real aggregate stage durations from Garmin)
      await WellnessRepo.upsert({
        date,
        sleep_score: v.sleepScore != null ? Math.round(v.sleepScore) : null,
        sleep_secs: v.totalSleepTimeInSeconds != null ? Math.round(v.totalSleepTimeInSeconds) : null,
        resting_hr: v.restingHeartRate != null ? Math.round(v.restingHeartRate) : null,
        hrv: v.avgOvernightHrv != null ? Number(v.avgOvernightHrv) : null,
        deep_sleep_secs: v.deepTime != null ? Math.round(v.deepTime) : null,
        light_sleep_secs: v.lightTime != null ? Math.round(v.lightTime) : null,
        rem_sleep_secs: v.remTime != null ? Math.round(v.remTime) : null,
        awake_secs: v.awakeTime != null ? Math.round(v.awakeTime) : null,
        raw_json: JSON.stringify(item),
      });

      // 3. Sleep stage intervals: Real hypnogram intervals from Garmin sleepLevels
      if (Array.isArray(item.sleepStages) && item.sleepStages.length > 0) {
        await SleepRepo.upsertStages(date, item.sleepStages);
      }

      // 4. Nocturnal HR: Real per-sample data from Garmin sleepHeartRate
      if (Array.isArray(item.sleepHeartRate) && item.sleepHeartRate.length > 0) {
        await HeartRateRepo.upsertSamples(item.sleepHeartRate);
      }

      count++;
    }

    return count;
  }

  /**
   * Complete sync workflow: fetches from Garmin Connect and ingests into DB.
   * Includes 5-minute cooldown throttle to protect against Garmin rate limits.
   * @param {string} [startDate]
   * @param {string} [endDate]
   * @param {object} [options]
   * @param {boolean} [options.force] - Bypass 5-minute cooldown
   */
  static async sync(startDate, endDate, options = {}) {
    const end = endDate || todayStr();
    const start = startDate || daysAgo(27);

    const now = Date.now();
    if (!options.force && now - lastSyncTimestamp < COOLDOWN_MS) {
      console.log(`[GarminConnectService] Sync throttled (last sync was ${Math.round((now - lastSyncTimestamp) / 1000)}s ago). Reusing latest data.`);
      return {
        success: true,
        throttled: true,
        importedCount: 0,
        range: { startDate: start, endDate: end },
      };
    }

    console.log(`[GarminConnectService] Starting Garmin Connect sync for ${start} -> ${end}...`);

    // Helper to split date ranges exceeding 27 days
    const chunks = [];
    let cur = new Date(`${start}T00:00:00Z`);
    const finalDate = new Date(`${end}T00:00:00Z`);

    while (cur <= finalDate) {
      const nextEnd = new Date(cur);
      nextEnd.setUTCDate(nextEnd.getUTCDate() + 26);
      const actualEnd = nextEnd < finalDate ? nextEnd : finalDate;

      chunks.push({
        start: cur.toISOString().split('T')[0],
        end: actualEnd.toISOString().split('T')[0],
      });

      cur = new Date(actualEnd);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const aggregatedIndividualStats = [];
    let overallStats = null;

    for (const chunk of chunks) {
      console.log(`[GarminConnectService] Fetching chunk: ${chunk.start} -> ${chunk.end}`);
      let chunkData;
      try {
        chunkData = await GarminConnectService.fetchSleepStats(chunk.start, chunk.end, options);
      } catch (err) {
        if (options.useCache) {
          const cachePath = path.resolve(process.cwd(), 'garmin_scraped_sleep.json');
          if (fs.existsSync(cachePath)) {
            console.warn('[GarminConnectService] Live fetch failed, using cached garmin_scraped_sleep.json:', err.message);
            chunkData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (chunkData?.individualStats) {
        aggregatedIndividualStats.push(...chunkData.individualStats);
      }
      if (!overallStats && chunkData?.overallStats) {
        overallStats = chunkData.overallStats;
      }
    }

    // Dedup individualStats by calendarDate
    const seen = new Set();
    const dedupedStats = [];
    for (const s of aggregatedIndividualStats) {
      if (!seen.has(s.calendarDate)) {
        seen.add(s.calendarDate);
        dedupedStats.push(s);
      }
    }

    const imported = await GarminConnectService.importSleepData({
      overallStats,
      individualStats: dedupedStats,
    });
    console.log(`[GarminConnectService] Successfully synced & imported ${imported} days from Garmin Connect.`);
    lastSyncTimestamp = Date.now();

    // Refresh circadian recommendation
    try {
      await SleepEngineService.getRecommendation(end);
    } catch (engineErr) {
      console.warn('[GarminConnectService] Sleep engine recommendation refresh warning:', engineErr.message);
    }

    return {
      success: true,
      importedCount: imported,
      range: { startDate: start, endDate: end },
    };
  }
}
