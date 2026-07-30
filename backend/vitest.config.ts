import { defineConfig } from "vitest/config";

// Loads backend/tests/setup.ts before any test file so process.env (JWT_SECRET,
// DATABASE_URL) is populated — required by config.ts and the HTTP test harness,
// which boots the real Express app + Prisma against the seeded dev DB.
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // The HTTP-level tests share a single SQLite dev DB; run serially to keep
    // YTD-accumulation and reconciliation fixtures deterministic across files.
    fileParallelism: false,
  },
});
