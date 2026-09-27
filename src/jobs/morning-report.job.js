import cron from 'node-cron';
import { HealthService } from '../services/health.service.js';
import { ReportRepo } from '../repositories/report.repo.js';
import { AiService } from '../services/ai.service.js';
import { NotificationService } from '../services/notification.service.js';
import { SleepEngineService } from '../services/sleep-engine.service.js';
import { buildMomSystemPrompt, buildHealthContext, judgeSleep } from '../utils/mom-persona.js';
import { analyzeWeekPattern } from '../utils/sleep-analyzer.js';
import { todayStr } from '../utils/date.js';
import { env } from '../config/env.js';

/**
 * Runs daily at 07:30 AM in user's timezone to generate Mom's morning sleep report
 * and send a push notification to iPhone via ntfy.sh.
 */
export function startMorningReportJob() {
  // 07:30 AM every day
  cron.schedule('30 7 * * *', async () => {
    const today = todayStr();
    console.log(`[morning-report] Running morning report generation for ${today}...`);

    try {
      // Check if already generated today
      const existing = await ReportRepo.getByDate(today);
      if (existing) {
        console.log(`[morning-report] Report already exists for ${today}. Skipping.`);
        return;
      }

      const dashData = await HealthService.getDashboardData(today);
      const weeklyData = await HealthService.getWeeklySleep(today);
      const weekPattern = analyzeWeekPattern(weeklyData);
      const sleepRec = await SleepEngineService.getRecommendation(today);

      const healthContext = buildHealthContext({
        ...dashData,
        sleepEngineRecommendation: sleepRec,
        weekSummary: weekPattern.summary,
      });

      const prompt = `Provide a concise morning sleep and recovery briefing based on the user's data.
Mention bedtime, total duration, deep sleep, and recovery metrics.
Keep it direct, analytical, encouraging, and actionable (2-3 concise sentences).`;

      const reportContent = await AiService.generateMomReport(
        buildMomSystemPrompt(),
        healthContext,
        prompt
      );

      const bedtimeHour = dashData.bedtime ? new Date(dashData.bedtime).getHours() : null;
      const verdict = judgeSleep(dashData.sleepHours, bedtimeHour);

      // Save to database
      await ReportRepo.upsertReport({
        date: today,
        content: reportContent,
        sleepVerdict: verdict,
        recommendedBedtime: sleepRec.recommendedBedtime,
        sleepEngineAnalysis: sleepRec,
      });

      console.log(`[morning-report] Report generated for ${today}. Verdict: ${verdict}`);

      // Dispatch push notification to iPhone via ntfy.sh
      await NotificationService.sendMorningReport(reportContent, verdict);
    } catch (err) {
      console.error('[morning-report] Error generating morning report:', err);
    }
  }, {
    timezone: env.TIMEZONE,
  });

  console.log(`⏰ Morning report job scheduled (daily at 07:30 AM ${env.TIMEZONE})`);
}
