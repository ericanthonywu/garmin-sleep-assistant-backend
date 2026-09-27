import { env } from '../config/env.js';

export class NotificationService {
  /**
   * Send a push notification via ntfy.sh.
   * @param {{ title: string, body: string, priority?: string, clickUrl?: string }} param0
   */
  static async sendPush({ title, body, priority = 'default', clickUrl = null }) {
    // Suppress real push notifications during tests or when explicitly disabled
    if (process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test' || process.env.DISABLE_NOTIFICATIONS === 'true') {
      console.log(`[NotificationService] Test mode — suppressed real push alert: "${title}"`);
      return;
    }

    if (!env.NTFY_TOPIC) {
      console.warn('[NotificationService] NTFY_TOPIC not configured. Skipping push.');
      return;
    }

    const headers = {
      'Title': title,
      'Priority': priority,
    };
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
    const emojis = { good: '☀️', okay: '🌤️', bad: '😤', terrible: '🚨' };
    const emoji = emojis[sleepVerdict] || '☀️';
    const title = `${emoji} Mama's Morning Sleep Note`;

    // Keep notification body under 300 chars for clean lock screen preview
    const cleanBody = (reportText || '').trim().replace(/\n+/g, ' ');
    const preview = cleanBody.length > 250 ? cleanBody.substring(0, 247) + '...' : cleanBody;

    await NotificationService.sendPush({
      title,
      body: preview,
      priority: sleepVerdict === 'terrible' ? 'high' : 'default',
    });
  }
}
