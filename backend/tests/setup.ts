// Global test setup — loads .env so config.ts (which fails fast on a missing
// JWT_SECRET) and the Prisma client (DATABASE_URL) work inside vitest, exactly
// as they do at runtime via index.ts's `import "dotenv/config"`.
import "dotenv/config";
