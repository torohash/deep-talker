export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  COOKIE_SECURE: "true" | "false";
}
