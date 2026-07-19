// Workflow-automation alert engine. Scans employee/certification data for
// upcoming events (probation confirmation, contract expiry, work-pass expiry,
// certification renewal) and materialises Alert rows. Shared by the workflow,
// lifecycle and learning modules — do NOT re-implement elsewhere.
import { prisma } from "../prisma.js";

// Days-ahead window within which an upcoming event raises an alert.
export const ALERT_WINDOW_DAYS = 45;

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function severityFor(days: number): "info" | "warning" | "critical" {
  if (days <= 7) return "critical";
  if (days <= 21) return "warning";
  return "info";
}

interface PendingAlert {
  employeeId: number;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  dueDate: Date;
  targetRole: string;
}

// Recompute alerts across all employees + certifications. Idempotent: clears
// auto-generated alerts and regenerates them, preserving read state by (type,employeeId,dueDate).
export async function regenerateAlerts(): Promise<number> {
  const employees = await prisma.employee.findMany({
    where: { status: { notIn: ["resigned", "terminated"] } },
    include: { certifications: true },
  });

  const pending: PendingAlert[] = [];

  for (const emp of employees) {
    const name = `${emp.firstName} ${emp.lastName}`;

    const probDays = daysUntil(emp.probationEndDate);
    if (emp.status === "probation" && probDays !== null && probDays <= ALERT_WINDOW_DAYS && probDays >= -7) {
      pending.push({
        employeeId: emp.id,
        type: "probation",
        severity: severityFor(probDays),
        title: "Probation confirmation due",
        message: `${name}'s probation ends in ${probDays} day(s). Confirmation review required.`,
        dueDate: emp.probationEndDate!,
        targetRole: "hr",
      });
    }

    const contractDays = daysUntil(emp.contractEndDate);
    if (contractDays !== null && contractDays <= ALERT_WINDOW_DAYS && contractDays >= -7) {
      pending.push({
        employeeId: emp.id,
        type: "contract-expiry",
        severity: severityFor(contractDays),
        title: "Contract expiring",
        message: `${name}'s contract expires in ${contractDays} day(s).`,
        dueDate: emp.contractEndDate!,
        targetRole: "hr",
      });
    }

    const passDays = daysUntil(emp.workPassExpiry);
    if (passDays !== null && passDays <= ALERT_WINDOW_DAYS && passDays >= -7) {
      pending.push({
        employeeId: emp.id,
        type: "workpass-expiry",
        severity: severityFor(passDays),
        title: "Work pass expiring",
        message: `${name}'s ${(emp.workPassType || "work pass").toUpperCase()} expires in ${passDays} day(s).`,
        dueDate: emp.workPassExpiry!,
        targetRole: "hr",
      });
    }

    for (const cert of emp.certifications) {
      const certDays = daysUntil(cert.expiryDate);
      if (certDays !== null && certDays <= ALERT_WINDOW_DAYS && certDays >= -7) {
        pending.push({
          employeeId: emp.id,
          type: "cert-renewal",
          severity: severityFor(certDays),
          title: "Certification renewal due",
          message: `${name}'s "${cert.name}"${cert.mandatory ? " (mandatory)" : ""} expires in ${certDays} day(s).`,
          dueDate: cert.expiryDate!,
          targetRole: "manager",
        });
      }
    }
  }

  // Preserve read-state of existing matching alerts, then replace the set.
  const existing = await prisma.alert.findMany();
  const readKeys = new Set(
    existing.filter((a) => a.read).map((a) => `${a.type}:${a.employeeId}:${a.dueDate?.toISOString() ?? ""}`)
  );

  await prisma.alert.deleteMany({});
  if (pending.length) {
    await prisma.alert.createMany({
      data: pending.map((p) => ({
        ...p,
        read: readKeys.has(`${p.type}:${p.employeeId}:${p.dueDate.toISOString()}`),
      })),
    });
  }
  return pending.length;
}
