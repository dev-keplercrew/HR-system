// Comprehensive demo seed across all 9 HRIS modules.
// Idempotent-ish: wipes existing rows then re-creates a representative dataset.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma.js";
import { buildPayslip } from "../src/services/payrollCalc.js";
import { regenerateAlerts } from "../src/services/alerts.js";

const PASSWORD = "password123";

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}
function yearsAgo(y: number): Date {
  const dt = new Date();
  dt.setFullYear(dt.getFullYear() - y);
  return dt;
}

async function wipe() {
  // Delete in FK-safe order.
  await prisma.auditLog.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.overtimeRequest.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.certification.deleteMany();
  await prisma.trainingRecord.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.offboardingTask.deleteMany();
  await prisma.onboardingTask.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.performanceReview.deleteMany();
  await prisma.savedReport.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.claimType.deleteMany();
  await prisma.payslip.deleteMany();
  await prisma.payrollRun.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.leaveType.deleteMany();
  await prisma.qualification.deleteMany();
  await prisma.emergencyContact.deleteMany();
  await prisma.document.deleteMany();
  await prisma.employmentHistory.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log("Seeding HRIS demo data…");
  await wipe();
  const hash = await bcrypt.hash(PASSWORD, 10);

  // --- Departments ---
  const deptData = [
    { name: "Human Resources", code: "HR" },
    { name: "Engineering", code: "ENG" },
    { name: "Finance", code: "FIN" },
    { name: "Sales & Marketing", code: "SNM" },
    { name: "Operations", code: "OPS" },
  ];
  const departments = [];
  for (const d of deptData) departments.push(await prisma.department.create({ data: d }));
  const deptByCode = Object.fromEntries(departments.map((d) => [d.code, d]));

  // --- Employees (with linked users for the 4 demo roles) ---
  interface Spec {
    employeeNo: string;
    firstName: string;
    lastName: string;
    email: string;
    role?: "admin" | "hr" | "manager" | "employee";
    dept: string;
    jobTitle: string;
    payrollGroup: string;
    basicSalary: number;
    workPassType: string;
    status?: string;
    dob: Date;
    joinYearsAgo: number;
    probationEndDate?: Date | null;
    contractEndDate?: Date | null;
    workPassExpiry?: Date | null;
    managerNo?: string;
  }

  const specs: Spec[] = [
    { employeeNo: "M001", firstName: "Aisha", lastName: "Rahman", email: "admin@meridian.sg", role: "admin", dept: "HR", jobTitle: "HR Director", payrollGroup: "management", basicSalary: 12000, workPassType: "citizen", dob: new Date("1980-04-12"), joinYearsAgo: 8 },
    { employeeNo: "M002", firstName: "Priya", lastName: "Nair", email: "hr@meridian.sg", role: "hr", dept: "HR", jobTitle: "HR Business Partner", payrollGroup: "executive", basicSalary: 6500, workPassType: "citizen", dob: new Date("1990-09-05"), joinYearsAgo: 4, managerNo: "M001" },
    { employeeNo: "M003", firstName: "Daniel", lastName: "Lim", email: "manager@meridian.sg", role: "manager", dept: "ENG", jobTitle: "Engineering Manager", payrollGroup: "management", basicSalary: 11000, workPassType: "citizen", dob: new Date("1985-01-22"), joinYearsAgo: 6, managerNo: "M001" },
    { employeeNo: "M004", firstName: "Wei", lastName: "Tan", email: "employee@meridian.sg", role: "employee", dept: "ENG", jobTitle: "Senior Software Engineer", payrollGroup: "executive", basicSalary: 7200, workPassType: "citizen", dob: new Date("1992-11-30"), joinYearsAgo: 3, managerNo: "M003" },
    { employeeNo: "M005", firstName: "Mei Ling", lastName: "Goh", email: "meiling.goh@meridian.sg", dept: "FIN", jobTitle: "Finance Analyst", payrollGroup: "executive", basicSalary: 5200, workPassType: "citizen", dob: new Date("1994-06-18"), joinYearsAgo: 2, managerNo: "M001" },
    { employeeNo: "M006", firstName: "Arjun", lastName: "Menon", email: "arjun.menon@meridian.sg", dept: "ENG", jobTitle: "Software Engineer", payrollGroup: "executive", basicSalary: 5800, workPassType: "ep", dob: new Date("1993-03-09"), joinYearsAgo: 1, managerNo: "M003", workPassExpiry: daysFromNow(30) },
    { employeeNo: "M007", firstName: "Sofia", lastName: "Reyes", email: "sofia.reyes@meridian.sg", dept: "SNM", jobTitle: "Marketing Executive", payrollGroup: "general", basicSalary: 4200, workPassType: "sp", status: "probation", dob: new Date("1996-12-01"), joinYearsAgo: 0, probationEndDate: daysFromNow(15), workPassExpiry: daysFromNow(120), managerNo: "M001" },
    { employeeNo: "M008", firstName: "Hafiz", lastName: "Osman", email: "hafiz.osman@meridian.sg", dept: "OPS", jobTitle: "Operations Lead", payrollGroup: "executive", basicSalary: 6000, workPassType: "pr", dob: new Date("1988-07-25"), joinYearsAgo: 5, managerNo: "M001" },
    { employeeNo: "M009", firstName: "Grace", lastName: "Chua", email: "grace.chua@meridian.sg", dept: "SNM", jobTitle: "Sales Manager", payrollGroup: "management", basicSalary: 9500, workPassType: "citizen", dob: new Date("1983-02-14"), joinYearsAgo: 7, managerNo: "M001" },
    { employeeNo: "M010", firstName: "Kenji", lastName: "Sato", email: "kenji.sato@meridian.sg", dept: "ENG", jobTitle: "DevOps Engineer", payrollGroup: "executive", basicSalary: 6800, workPassType: "ep", dob: new Date("1991-10-10"), joinYearsAgo: 2, managerNo: "M003", contractEndDate: daysFromNow(25), workPassExpiry: daysFromNow(200) },
    { employeeNo: "M011", firstName: "Nurul", lastName: "Aziz", email: "nurul.aziz@meridian.sg", dept: "FIN", jobTitle: "Payroll Officer", payrollGroup: "general", basicSalary: 4600, workPassType: "citizen", dob: new Date("1995-05-20"), joinYearsAgo: 1, managerNo: "M001" },
    { employeeNo: "M012", firstName: "Rajesh", lastName: "Kumar", email: "rajesh.kumar@meridian.sg", dept: "OPS", jobTitle: "Warehouse Supervisor", payrollGroup: "hourly", basicSalary: 3200, workPassType: "wp", status: "probation", dob: new Date("1990-08-08"), joinYearsAgo: 0, probationEndDate: daysFromNow(40), workPassExpiry: daysFromNow(60), managerNo: "M008" },
  ];

  const empByNo: Record<string, any> = {};
  // First pass: create employees (+ users) without manager links.
  for (const s of specs) {
    let userId: number | undefined;
    if (s.role) {
      const user = await prisma.user.create({
        data: { email: s.email.toLowerCase(), passwordHash: hash, role: s.role },
      });
      userId = user.id;
    }
    const emp = await prisma.employee.create({
      data: {
        employeeNo: s.employeeNo,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email.toLowerCase(),
        phone: "+65 8" + Math.floor(1000000 + Math.random() * 8999999),
        dateOfBirth: s.dob,
        gender: ["Aisha", "Priya", "Mei Ling", "Sofia", "Grace", "Nurul"].includes(s.firstName) ? "female" : "male",
        maritalStatus: s.joinYearsAgo > 4 ? "married" : "single",
        nationality: s.workPassType === "citizen" || s.workPassType === "pr" ? "Singaporean" : "Foreigner",
        nric: s.workPassType === "citizen" ? "S****" + (100 + Math.floor(Math.random() * 899)) + "A" : null,
        address: `${10 + Math.floor(Math.random() * 90)} Meridian Ave, #0${1 + Math.floor(Math.random() * 8)}-${10 + Math.floor(Math.random() * 89)}, Singapore`,
        jobTitle: s.jobTitle,
        employmentType: s.workPassType === "wp" ? "contract" : "full-time",
        payrollGroup: s.payrollGroup,
        status: s.status ?? "active",
        joinDate: yearsAgo(s.joinYearsAgo),
        confirmationDate: s.status === "probation" ? null : yearsAgo(s.joinYearsAgo > 0 ? s.joinYearsAgo : 0),
        probationEndDate: s.probationEndDate ?? null,
        contractEndDate: s.contractEndDate ?? null,
        workPassType: s.workPassType,
        workPassExpiry: s.workPassExpiry ?? null,
        basicSalary: s.basicSalary,
        bankName: ["DBS", "OCBC", "UOB"][Math.floor(Math.random() * 3)],
        bankAccount: String(Math.floor(100000000 + Math.random() * 899999999)),
        departmentId: deptByCode[s.dept].id,
        userId,
      },
    });
    empByNo[s.employeeNo] = emp;
  }
  // Second pass: manager links.
  for (const s of specs) {
    if (s.managerNo && empByNo[s.managerNo]) {
      await prisma.employee.update({
        where: { id: empByNo[s.employeeNo].id },
        data: { managerId: empByNo[s.managerNo].id },
      });
    }
  }

  const allEmps = Object.values(empByNo) as any[];

  // --- Employment history, documents, contacts, qualifications ---
  for (const emp of allEmps) {
    await prisma.employmentHistory.create({
      data: { employeeId: emp.id, title: emp.jobTitle, department: null, startDate: emp.joinDate, note: "Current appointment" },
    });
    await prisma.document.create({
      data: { employeeId: emp.id, name: "Employment Contract.pdf", category: "contract", filePath: `/documents/${emp.employeeNo}/contract.pdf` },
    });
    await prisma.emergencyContact.create({
      data: { employeeId: emp.id, name: "Next of Kin", relationship: "Spouse", phone: "+65 9123 4567" },
    });
    await prisma.qualification.create({
      data: { employeeId: emp.id, title: "Bachelor's Degree", institution: "National University of Singapore", type: "qualification", obtainedDate: yearsAgo(10) },
    });
  }

  // --- Leave types + balances + a couple of requests ---
  const leaveTypes = [];
  for (const lt of [
    { name: "Annual Leave", code: "AL", annualQuota: 18, paid: true },
    { name: "Medical Leave", code: "ML", annualQuota: 14, paid: true },
    { name: "Childcare Leave", code: "CCL", annualQuota: 6, paid: true },
    { name: "Unpaid Leave", code: "UL", annualQuota: 0, paid: false },
  ]) {
    leaveTypes.push(await prisma.leaveType.create({ data: lt }));
  }
  const year = new Date().getFullYear();
  for (const emp of allEmps) {
    for (const lt of leaveTypes) {
      const taken = lt.code === "AL" ? Math.floor(Math.random() * 6) : 0;
      await prisma.leaveBalance.create({
        data: { employeeId: emp.id, leaveTypeId: lt.id, year, entitled: lt.annualQuota, taken, pending: 0 },
      });
    }
  }
  // A pending annual-leave request from the demo employee, awaiting the manager.
  const al = leaveTypes[0];
  await prisma.leaveRequest.create({
    data: { employeeId: empByNo["M004"].id, leaveTypeId: al.id, startDate: daysFromNow(10), endDate: daysFromNow(12), days: 3, reason: "Family trip", status: "pending" },
  });
  await prisma.leaveBalance.updateMany({ where: { employeeId: empByNo["M004"].id, leaveTypeId: al.id, year }, data: { pending: 3 } });
  await prisma.leaveRequest.create({
    data: { employeeId: empByNo["M006"].id, leaveTypeId: leaveTypes[1].id, startDate: daysFromNow(-5), endDate: daysFromNow(-4), days: 2, reason: "Flu", status: "approved", approverId: empByNo["M003"].id, decidedAt: daysFromNow(-6) },
  });

  // --- Claim types + claims ---
  const claimTypes = [];
  for (const ct of [
    { name: "Medical Claim", code: "MED", annualCap: 2000 },
    { name: "Dental", code: "DEN", annualCap: 500 },
    { name: "Training & Development", code: "TRN", annualCap: 3000 },
    { name: "Transport", code: "TRP", annualCap: 1200 },
  ]) {
    claimTypes.push(await prisma.claimType.create({ data: ct }));
  }
  await prisma.claim.create({
    data: { employeeId: empByNo["M004"].id, claimTypeId: claimTypes[0].id, amount: 145.5, description: "GP consultation + medication", status: "pending" },
  });
  await prisma.claim.create({
    data: { employeeId: empByNo["M005"].id, claimTypeId: claimTypes[2].id, amount: 899, description: "AWS certification course", status: "approved", approverId: empByNo["M001"].id, decidedAt: daysFromNow(-3) },
  });
  await prisma.claim.create({
    data: { employeeId: empByNo["M004"].id, claimTypeId: claimTypes[3].id, amount: 32, description: "Client visit taxi", status: "paid", approverId: empByNo["M003"].id, decidedAt: daysFromNow(-10) },
  });

  // --- A finalised payroll run for the current period (executive group) ---
  const period = `${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const run = await prisma.payrollRun.create({ data: { period, payrollGroup: "executive", status: "finalised" } });
  let gGross = 0, gNet = 0, gCpf = 0;
  for (const emp of allEmps.filter((e) => e.payrollGroup === "executive")) {
    const allowances = Math.round(emp.basicSalary * 0.1);
    const fig = buildPayslip({ basicSalary: emp.basicSalary, allowances, dateOfBirth: emp.dateOfBirth, workPassType: emp.workPassType });
    gGross += fig.grossPay; gNet += fig.netPay; gCpf += fig.totalCpf;
    await prisma.payslip.create({
      data: {
        payrollRunId: run.id, employeeId: emp.id,
        basicPay: fig.basicPay, allowances: fig.allowances, grossPay: fig.grossPay,
        employeeCpf: fig.employeeCpf, employerCpf: fig.employerCpf, netPay: fig.netPay,
      },
    });
  }
  await prisma.payrollRun.update({ where: { id: run.id }, data: { totalGross: gGross, totalNet: gNet, totalCpf: gCpf } });

  // --- Certifications (some expiring → drives alerts) + training ---
  await prisma.certification.create({ data: { employeeId: empByNo["M010"].id, name: "AWS Solutions Architect", authority: "AWS", issuedDate: yearsAgo(3), expiryDate: daysFromNow(20), mandatory: true } });
  await prisma.certification.create({ data: { employeeId: empByNo["M012"].id, name: "Forklift Operator (WSQ)", authority: "SkillsFuture Singapore", issuedDate: yearsAgo(2), expiryDate: daysFromNow(10), mandatory: true } });
  await prisma.certification.create({ data: { employeeId: empByNo["M008"].id, name: "First Aid & CPR", authority: "SRC", issuedDate: yearsAgo(1), expiryDate: daysFromNow(300), mandatory: false } });
  for (const emp of allEmps.slice(0, 6)) {
    await prisma.trainingRecord.create({ data: { employeeId: emp.id, courseName: "Workplace Safety Orientation", provider: "Internal L&D", completedAt: daysFromNow(-40), hours: 4, status: "completed" } });
  }
  await prisma.trainingRecord.create({ data: { employeeId: empByNo["M004"].id, courseName: "Advanced TypeScript", provider: "Frontend Masters", hours: 12, status: "in-progress" } });

  // --- Performance reviews + goals ---
  for (const emp of allEmps.filter((e) => e.status === "active").slice(0, 8)) {
    await prisma.goal.create({ data: { employeeId: emp.id, cycle: String(year), title: "Deliver key project milestones", description: "Own and ship assigned deliverables on time.", weight: 40, progress: 60, status: "active" } });
    await prisma.goal.create({ data: { employeeId: emp.id, cycle: String(year), title: "Professional development", description: "Complete one certification this cycle.", weight: 20, progress: 30, status: "active" } });
    await prisma.performanceReview.create({ data: { employeeId: emp.id, cycle: String(year), stage: "mid-year", rating: 3 + Math.floor(Math.random() * 3) > 5 ? 5 : 3 + Math.floor(Math.random() * 2), comments: "Solid mid-year performance.", status: "finalised", reviewerId: empByNo["M001"].id } });
  }

  // --- Lifecycle: onboarding tasks for the newest hires, assets ---
  for (const empNo of ["M007", "M012"]) {
    const emp = empByNo[empNo];
    for (const t of [
      { title: "Provision laptop & accounts", department: "IT" },
      { title: "Grant building access card", department: "Facilities" },
      { title: "Assign onboarding buddy", department: "Hiring Manager" },
      { title: "Complete HR documentation", department: "HR" },
    ]) {
      await prisma.onboardingTask.create({ data: { employeeId: emp.id, title: t.title, department: t.department, dueDate: daysFromNow(7), status: Math.random() > 0.6 ? "done" : "pending" } });
    }
  }
  const assets = [
    { tag: "LT-0012", name: 'MacBook Pro 14"', category: "hardware", employeeNo: "M004" },
    { tag: "LT-0018", name: "ThinkPad X1", category: "hardware", employeeNo: "M006" },
    { tag: "AC-0301", name: "Access Card", category: "access-card", employeeNo: "M007" },
    { tag: "PH-0044", name: "iPhone 14", category: "phone", employeeNo: null },
  ];
  for (const a of assets) {
    await prisma.asset.create({
      data: {
        tag: a.tag, name: a.name, category: a.category,
        status: a.employeeNo ? "issued" : "available",
        employeeId: a.employeeNo ? empByNo[a.employeeNo].id : null,
        issuedDate: a.employeeNo ? daysFromNow(-100) : null,
      },
    });
  }

  // --- Recruitment ---
  const req = await prisma.requisition.create({ data: { title: "Frontend Engineer", department: "Engineering", headcount: 2, status: "approved", justification: "Team expansion for Q3 roadmap", approverId: empByNo["M001"].id } });
  const req2 = await prisma.requisition.create({ data: { title: "Finance Executive", department: "Finance", headcount: 1, status: "posted", justification: "Backfill" } });
  const c1 = await prisma.candidate.create({ data: { requisitionId: req.id, name: "Lena Ong", email: "lena.ong@example.com", phone: "+65 9111 2222", source: "referral", stage: "interview" } });
  await prisma.candidate.create({ data: { requisitionId: req.id, name: "Tom Baker", email: "tom.baker@example.com", source: "jobboard", stage: "screening" } });
  await prisma.candidate.create({ data: { requisitionId: req2.id, name: "Divya Shah", email: "divya.shah@example.com", source: "agency", stage: "offer" } });
  await prisma.interview.create({ data: { candidateId: c1.id, round: 1, scheduledAt: daysFromNow(-2), interviewer: "Daniel Lim", score: 4, feedback: "Strong React fundamentals.", status: "completed" } });
  await prisma.interview.create({ data: { candidateId: c1.id, round: 2, scheduledAt: daysFromNow(3), interviewer: "Wei Tan", status: "scheduled" } });

  // --- Time & Attendance ---
  for (const emp of allEmps.slice(0, 6)) {
    await prisma.shift.create({ data: { employeeId: emp.id, date: daysFromNow(1), startTime: "09:00", endTime: "18:00", location: "HQ" } });
    const worked = 8 + (Math.random() > 0.5 ? 2 : 0);
    await prisma.attendanceRecord.create({
      data: { employeeId: emp.id, date: daysFromNow(-1), clockIn: new Date(new Date().setHours(9, 2, 0, 0)), clockOut: new Date(new Date().setHours(9 + worked, 0, 0, 0)), scheduledHours: 8, workedHours: worked, overtimeHours: Math.max(0, worked - 8) },
    });
  }
  await prisma.overtimeRequest.create({ data: { employeeId: empByNo["M012"].id, date: daysFromNow(-1), hours: 3, reason: "Inventory stock-take", status: "pending" } });

  // --- Saved reports ---
  await prisma.savedReport.create({ data: { name: "Active Headcount by Department", source: "employees", fields: JSON.stringify(["employeeNo", "firstName", "lastName", "jobTitle", "status"]), filters: JSON.stringify({ status: "active" }) } });

  // --- Generate workflow alerts from the seeded data ---
  const count = await regenerateAlerts();
  console.log(`Generated ${count} workflow alerts.`);
  console.log("Seed complete. Demo login: admin@meridian.sg / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
