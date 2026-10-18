import { DashboardController } from '../controllers/dashboard.controller.js';
import { SleepController } from '../controllers/sleep.controller.js';
import { HealthController } from '../controllers/health.controller.js';
import { ChatController } from '../controllers/chat.controller.js';
import { SyncController } from '../controllers/sync.controller.js';
import { SupplementController } from '../controllers/supplement.controller.js';
import { env } from '../config/env.js';

export function registerRoutes(app) {
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'garmin-momcare-ai',
      timestamp: new Date().toISOString(),
      env: env.NODE_ENV,
    });
  });

  // Core API endpoints
  app.get('/api/dashboard', DashboardController.getDashboard);
  app.get('/api/sleep/calendar', SleepController.getSleepCalendar);
  app.get('/api/sleep/:date', SleepController.getSleepDetail);
  app.get('/api/sleep-engine/:date', SleepController.getSleepRecommendation);
  app.post('/api/health/sync', HealthController.syncHealthData);
  app.post('/api/chat', ChatController.chat);
  app.get('/api/chat/history', ChatController.getHistory);
  app.post('/api/sync/intervals', SyncController.triggerSync);
  app.post('/api/sync/garmin', SyncController.triggerGarminSync);

  // Supplement & Vitamin endpoints
  app.get('/api/supplements/magnesium', SupplementController.getMagnesiumStatus);
  app.post('/api/supplements/magnesium', SupplementController.logMagnesium);
  app.post('/api/supplements/magnesium/remind', SupplementController.sendMagnesiumReminder);
}
