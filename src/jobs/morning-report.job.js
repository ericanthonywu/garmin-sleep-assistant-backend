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

export async function generateMorningReportForDate(targetDate = todayStr(), force = false) {
  console.log(`[morning-report] Running morning report generation for ${targetDate}...`);

  try {
    const existing = await ReportRepo.getByDate(targetDate);
    // If detailed report already generated and not forced, skip
    if (existing && !force && !existing.content.includes('check your bedtime consistency')) {
      console.log(`[morning-report] Detailed report already exists for ${targetDate}. Skipping.`);
      return existing;
    }

    const dashData = await HealthService.getDashboardData(targetDate);
    if (!dashData || !dashData.sleepHours || dashData.sleepHours <= 0) {
      console.log(`[morning-report] No sleep data recorded yet for ${targetDate}. Deferring report generation.`);
      return null;
    }
    const weeklyData = await HealthService.getWeeklySleep(targetDate);
    const weekPattern = analyzeWeekPattern(weeklyData);
    const sleepRec = await SleepEngineService.getRecommendation(targetDate);

    const healthContext = buildHealthContext({
      ...dashData,
      sleepEngineRecommendation: sleepRec,
      weekSummary: weekPattern.summary,
    });

    const prompt = `Provide a concise morning sleep & recovery briefing based on the user's health context.
Analyze both:
1. Sleep Timing: Bedtime, wake time, and circadian consistency.
2. Quality of Sleep: Deep sleep restoration (NREM 3), REM percentage, and overnight resting heart rate.
Highlight tonight's recommended bedtime and the latest sleep cutoff. Keep it direct, analytical, encouraging, and actionable (2-3 concise paragraphs).`;

    const reportContent = await AiService.generateMomReport(
      buildMomSystemPrompt(),
      healthContext,
      prompt
    );

    let bedtimeHour = null;
    if (dashData.bedtime) {
      if (dashData.bedtime.includes('T')) {
        bedtimeHour = new Date(dashData.bedtime).getHours();
      } else if (dashData.bedtime.includes(':')) {
        bedtimeHour = parseInt(dashData.bedtime.split(':')[0], 10);
      }
    }
    const verdict = judgeSleep(dashData.sleepHours, bedtimeHour);

    // Save to database
    await ReportRepo.upsertReport({
      date: targetDate,
      content: reportContent,
      sleepVerdict: verdict,
      recommendedBedtime: sleepRec.recommendedBedtime,
      sleepEngineAnalysis: sleepRec,
    });

    console.log(`[morning-report] Report generated for ${targetDate}. Verdict: ${verdict}`);

    // Dispatch push notification to iPhone via ntfy.sh
    await NotificationService.sendMorningReport(reportContent, verdict);
  } catch (err) {
    console.error('[morning-report] Error generating morning report:', err);
  }
}

/**
 * Runs daily at 07:30 AM in user's timezone to generate Mom's morning sleep report
 * and send a push notification to iPhone via ntfy.sh.
 */
export function startMorningReportJob() {
  cron.schedule('30 7 * * *', async () => {
    await generateMorningReportForDate(todayStr(), false);
  }, {
    timezone: env.TIMEZONE,
  });

  console.log(`⏰ Morning report job scheduled (daily at 07:30 AM ${env.TIMEZONE})`);
}
