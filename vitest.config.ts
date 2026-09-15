import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import type {} from "./tests/provided";

export default defineConfig({
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TURSO_DATABASE_URL: inject("databaseUrl"),
          TURSO_AUTH_TOKEN: "",
          COOKIE_SECURE: "false",
        },
      },
    })),
  ],
  test: { include: ["tests/*.test.ts"], globalSetup: ["./tests/setup.ts"] },
});
