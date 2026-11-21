export {};

declare global {
  interface Env {
    APP_ENV: 'local' | 'preview' | 'production';
    ACCOUNTS_URL: string;
    AUTH_API_URL: string;
    INTERNAL_API_SECRET: string;
    MC_AUTH_DB: D1Database;
    VERIFY_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  }
}
