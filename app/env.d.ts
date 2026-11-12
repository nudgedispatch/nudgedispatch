/** Bindings for the Nudge Dispatch Worker. Values stay in the host, never in git. */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface NudgeEnv {
  DB: D1Database;
  /** Bearer token for the non-UI admin API. Empty means that API stays hidden. */
  ADMIN_TOKEN?: string;
  /** Comma-separated platform admin emails. Unset or empty means nobody is a platform admin. */
  PLATFORM_ADMIN_EMAILS?: string;
  /** Bland SMS. Unused while SMS_MODE is off. */
  BLAND_API_KEY?: string;
  BLAND_FROM_NUMBER?: string;
  /** off (default) | test | live. This repo ships off. */
  SMS_MODE?: string;
  SMS_TEST_ALLOWLIST?: string;
  BLAND_API_BASE?: string;
  /** Google Routes API for distance quotes. Absent means distance quotes are skipped. */
  GOOGLE_MAPS_SERVER_KEY?: string;
  /** sk_ or rk_ test or live key. A live key is used only when STRIPE_MODE is live. */
  STRIPE_SECRET_KEY?: string;
  /** Unset allows test keys only. Set to live together with a live secret key. test also allowed. */
  STRIPE_MODE?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Customer portal configuration id for the same Stripe mode as the secret key. */
  STRIPE_PORTAL_CONFIGURATION?: string;
  STRIPE_API_BASE?: string;
}
