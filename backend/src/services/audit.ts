// Lightweight audit-log helper. Routes call `audit(...)` after mutations.
// Never throws into the request path — logging failures are swallowed.
import { prisma } from "../prisma.js";
import type { AuthPayload } from "../middleware/auth.js";

export async function audit(
  actor: AuthPayload | undefined,
  action: string,
  entity: string,
  entityId?: string | number | null,
  detail?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        detail: detail ?? null,
      },
    });
  } catch {
    // audit logging is best-effort; do not fail the request
  }
}
