import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { startIntervalsSyncJob } from './jobs/sync-intervals.job.js';
import { startMorningReportJob } from './jobs/morning-report.job.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// Mount application routes
registerRoutes(app);

// Global error handler
app.use(errorHandler);

// Start server
app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`🚀 Garmin MomCare backend running on port ${env.PORT} (${env.NODE_ENV})`);
  startIntervalsSyncJob();
  startMorningReportJob();
});

export default app;
