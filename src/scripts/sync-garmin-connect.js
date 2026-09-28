import { GarminConnectService } from '../services/garmin-connect.service.js';
import { todayStr, daysAgo } from '../utils/date.js';

async function main() {
  const args = process.argv.slice(2);
  let start = args[0];
  let end = args[1];
  const useCache = args.includes('--cache');

  if (!start || start.startsWith('--')) {
    start = daysAgo(28);
  }
  if (!end || end.startsWith('--')) {
    end = todayStr();
  }

  console.log(`[Script] Running Garmin Connect Sync: ${start} -> ${end} (useCache: ${useCache})`);
  try {
    const res = await GarminConnectService.sync(start, end, { useCache: true });
    console.log('[Script] Success:', JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[Script] Garmin Connect Sync failed:', err);
    process.exit(1);
  }
}

main();
