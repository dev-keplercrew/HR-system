// Central config, loaded from environment (.env via dotenv in index.ts).
// JWT_SECRET has no insecure fallback: an unset secret would let anyone who
// reads the public source forge tokens, so we fail fast at startup instead.
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required and must not be empty");
}

export const config = {
  jwtSecret: process.env.JWT_SECRET,
  port: Number(process.env.PORT || 4000),
  tokenTtl: 12 * 60 * 60, // seconds (12h) — numeric keeps jwt SignOptions.expiresIn type-safe
};
