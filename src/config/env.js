import 'dotenv/config';

const requiredInProd = ['DB_USER', 'DB_PASSWORD'];

for (const key of requiredInProd) {
  if (!process.env[key]) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`FATAL: Missing required env var: ${key}`);
      process.exit(1);
    } else {
      console.warn(`WARNING: Missing env var: ${key}`);
    }
  }
}

export const env = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME || 'garmin_momcare',
  PORT: parseInt(process.env.PORT || '3002', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  INTERVALS_API_KEY: process.env.INTERVALS_API_KEY || '',
  INTERVALS_ATHLETE_ID: process.env.INTERVALS_ATHLETE_ID || '',
  NTFY_TOPIC: process.env.NTFY_TOPIC || 'momcare-default',
  GARMIN_CONNECT_CSRF_TOKEN: process.env.GARMIN_CONNECT_CSRF_TOKEN || '',
  GARMIN_CONNECT_COOKIE: process.env.GARMIN_CONNECT_COOKIE || '',
  SLEEP_TARGET_HOURS: parseFloat(process.env.SLEEP_TARGET_HOURS || '8'),
  BEDTIME_TARGET: process.env.BEDTIME_TARGET || '02:00',
  SLEEP_LATENCY_MINUTES: parseInt(process.env.SLEEP_LATENCY_MINUTES || '15', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Jakarta',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
};
