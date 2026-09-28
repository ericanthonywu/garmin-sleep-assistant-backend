import { env } from '../config/env.js';

export class NotificationService {
  /**
   * Send a push notification via ntfy.sh.
   * @param {{ title: string, body: string, priority?: string, clickUrl?: string, sound?: string, tags?: string[] }} param0
   */
  static async sendPush({ title, body, priority = 'default', clickUrl = null, sound = null, tags = [] }) {
    // Suppress real push notifications during tests or when explicitly disabled
    if (process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test' || process.env.DISABLE_NOTIFICATIONS === 'true') {
      console.log(`[NotificationService] Test mode — suppressed real push alert: "${title}"`);
      return;
    }

    if (!env.NTFY_TOPIC) {
      console.warn('[NotificationService] NTFY_TOPIC not configured. Skipping push.');
      return;
    }

    // Strip non-ASCII characters from headers to prevent ByteString encoding errors
    const safeTitle = (title || 'MomCare Notification').replace(/[^\x20-\x7E]/g, '').trim() || 'MomCare Notification';

    const headers = {
      'Title': safeTitle,
      'Priority': priority,
    };
    if (sound) {
      headers['Sound'] = sound;
      headers['X-Sound'] = sound;
    }
    if (tags && tags.length > 0) {
      headers['Tags'] = tags.join(',');
      headers['X-Tags'] = tags.join(',');
    }
    if (clickUrl) {
      headers['Click'] = clickUrl;
    }

    try {
      const res = await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
        method: 'POST',
        body,
        headers,
      });

      if (!res.ok) {
        console.error(`[NotificationService] ntfy push returned status ${res.status}`);
      } else {
        console.log(`[NotificationService] Push delivered to topic ${env.NTFY_TOPIC}`);
      }
    } catch (err) {
      console.error('[NotificationService] Error sending ntfy push:', err.message);
    }
  }

  /**
   * Send the morning sleep report notification.
   */
  static async sendMorningReport(reportText, sleepVerdict) {
    const tagMap = { good: 'sunny', okay: 'partly_sunny', bad: 'warning', terrible: 'rotating_light' };
    const tag = tagMap[sleepVerdict] || 'sunny';
    const title = 'Morning Sleep & Recovery Briefing';

    // Keep notification body under 300 chars for clean lock screen preview
    const cleanBody = (reportText || '').trim().replace(/\n+/g, ' ');
    const preview = cleanBody.length > 250 ? cleanBody.substring(0, 247) + '...' : cleanBody;

    await NotificationService.sendPush({
      title,
      body: preview,
      priority: sleepVerdict === 'terrible' ? 'high' : 'default',
      tags: [tag],
    });
  }

  /**
   * Send one of tonight's silent bedtime nudges (dim, winddown, bedtime, cutoff, late).
   * Prominent lock screen notification with NO sound as requested.
   */
  static async sendBedtimeReminder({ kind, rec, currentTimeStr }) {
    const { recommendedBedtime, latestBedtimeCutoff, targetWakeTime } = rec;
    const messages = {
      dim: {
        title: `Dim the lights - bedtime is ${recommendedBedtime}`,
        body: `Switch to warm, dim lighting and lower screen brightness now. Bright light this late pushes your body clock later.`,
        tags: ['bulb'],
        priority: 'default',
      },
      winddown: {
        title: `Wind down - bedtime in 1 hour (${recommendedBedtime})`,
        body: `Start your wind-down routine: put work away, keep lights low, and avoid heavy food or intense exercise.`,
        tags: ['crescent_moon'],
        priority: 'default',
      },
      bedtime: {
        title: `Time for bed (${recommendedBedtime})`,
        body: `Lights out now to fall asleep on schedule. Target wake: ${targetWakeTime}. Latest bedtime tonight: ${latestBedtimeCutoff}.`,
        tags: ['bed'],
        priority: 'high',
      },
      cutoff: {
        title: `Latest bedtime reached (${latestBedtimeCutoff})`,
        body: `Going to bed now still leaves a full sleep window before ${targetWakeTime}. Put the phone away.`,
        tags: ['crescent_moon', 'bed'],
        priority: 'high',
      },
      late: {
        title: `Still awake? Past your ${latestBedtimeCutoff} cutoff (${currentTimeStr})`,
        body: `Every extra minute now comes out of tonight's sleep. Keep your wake time at ${targetWakeTime} anyway to protect tomorrow night.`,
        tags: ['warning', 'crescent_moon'],
        priority: 'high',
      },
    };
    const message = messages[kind] || messages.bedtime;

    await NotificationService.sendPush({
      title: message.title,
      body: message.body,
      priority: message.priority,
      sound: 'none', // Strictly silent (no sound) as requested
      tags: message.tags,
    });
  }
}
