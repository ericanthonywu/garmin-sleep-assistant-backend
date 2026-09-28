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
   * Send silent bedtime reminder push notification before and after latest sleep cutoff.
   * Prominent lock screen notification with NO sound as requested.
   */
  static async sendBedtimeReminder({ recommendedBedtime, latestCutoff, targetWakeTime, urgency = 'cutoff', currentTimeStr }) {
    let title = `Time for Bed — Latest Cutoff is ${latestCutoff}`;
    let body = `Circadian Ceiling Reached: Target was ${recommendedBedtime}. Sleep before ${latestCutoff} to protect deep restorative sleep (Target wake: ${targetWakeTime || '07:30'}).`;
    let tags = ['crescent_moon', 'bed'];

    if (urgency === 'winddown') {
      title = `Wind Down — Cutoff approaches at ${latestCutoff}`;
      body = `Target bedtime is ${recommendedBedtime}. Turn off blue light and start winding down now.`;
      tags = ['crescent_moon'];
    } else if (urgency === 'late') {
      title = `Still Awake? It's past your ${latestCutoff} cutoff (${currentTimeStr || 'Late'})`;
      body = `You are losing deep restorative sleep. Put away your phone and close your eyes now.`;
      tags = ['warning', 'crescent_moon'];
    } else if (urgency === 'critical') {
      title = `CRITICAL: Past 2:00 AM (${currentTimeStr || 'Late'})`;
      body = `Severe sleep debt warning. Core body temperature nadir is near. SLEEP NOW.`;
      tags = ['rotating_light', 'warning'];
    }

    await NotificationService.sendPush({
      title,
      body,
      priority: 'high',
      sound: 'none', // Strictly silent (no sound) as requested
      tags,
    });
  }
}
