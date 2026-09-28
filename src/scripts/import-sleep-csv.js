import fs from 'fs';
import path from 'path';
import { db } from '../db/knex.js';
import { isWeekend } from '../utils/date.js';

export async function importSleepCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    console.log('CSV is empty or has only header.');
    return;
  }

  const header = lines[0].split(',').map((h) => h.trim());
  console.log(`Processing CSV: ${filePath}`);
  console.log(`Header: ${header.join(', ')}`);

  const isWeeklySummary = header.includes('Avg Bedtime') || header.includes('Avg Score');

  if (isWeeklySummary) {
    console.log('Detected Garmin Weekly Aggregate CSV (37+ weeks).');
    const weeklyRows = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',').map((c) => c.trim());
      if (row.length >= 7 && row[1] !== '--') {
        weeklyRows.push({
          range: row[0],
          score: Number(row[1]) || null,
          quality: row[2],
          duration: row[3],
          sleepNeed: row[4],
          bedtime: row[5],
          wakeTime: row[6],
        });
      }
    }

    console.log(`Extracted ${weeklyRows.length} valid weekly summary rows.`);
    console.log('Latest week:', weeklyRows[0]);
    return { type: 'weekly', rows: weeklyRows };
  } else {
    // Daily rows format: Date, Score, Quality, Duration, Sleep Need, Bedtime, Wake Time
    console.log('Detected Garmin Daily Sleep CSV.');
    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',').map((c) => c.trim());
      if (row.length < 4 || row[1] === '--') continue;

      const dateStr = row[0]; // YYYY-MM-DD or Mon DD, YYYY
      const score = Number(row[1]) || null;
      const durationStr = row[3]; // e.g. "8h 14min"
      const bedtimeStr = row[5]; // e.g. "2:42 AM"
      const wakeTimeStr = row[6]; // e.g. "11:08 AM"

      // Parse duration to hours
      let hours = null;
      const hMatch = durationStr.match(/(\d+)h/);
      const mMatch = durationStr.match(/(\d+)min/);
      if (hMatch || mMatch) {
        const h = hMatch ? parseInt(hMatch[1], 10) : 0;
        const m = mMatch ? parseInt(mMatch[1], 10) : 0;
        hours = Number((h + m / 60).toFixed(1));
      }

      // Convert 12h AM/PM to 24h HH:mm
      const to24h = (time12) => {
        if (!time12 || time12 === '--') return null;
        const match = time12.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return time12;
        let h = parseInt(match[1], 10);
        const m = match[2];
        const ampm = match[3].toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${m}`;
      };

      const finalBedtime = to24h(bedtimeStr);
      const finalWake = to24h(wakeTimeStr);

      if (dateStr && (finalBedtime || hours)) {
        await db('bedtime_log')
          .insert({
            date: dateStr,
            bedtime: finalBedtime,
            wake_time: finalWake,
            sleep_hours: hours,
            is_weekend: /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? isWeekend(dateStr) : false,
          })
          .onConflict('date')
          .merge();

        if (score != null || hours != null) {
          await db('daily_wellness')
            .insert({
              date: dateStr,
              sleep_score: score,
              sleep_secs: hours ? Math.round(hours * 3600) : null,
            })
            .onConflict('date')
            .merge();
        }
        importedCount++;
      }
    }

    console.log(`Successfully imported ${importedCount} daily records.`);
    return { type: 'daily', count: importedCount };
  }
}

// If executed directly via CLI
if (process.argv[1]?.endsWith('import-sleep-csv.js')) {
  const target = process.argv[2] || '/Users/ericanthony/Downloads/Sleep.csv';
  importSleepCsv(target)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
