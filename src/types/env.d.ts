export {};

declare global {
  interface Env {
    APP_ENV: 'local' | 'production';
    ACCOUNTS_URL: string;
    AUTH_API_URL: string;
    INTERNAL_API_SECRET: string;
    CODE_HASH_SALT: string;
    MC_AUTH_DB: D1Database;
    VERIFY_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  }
}
