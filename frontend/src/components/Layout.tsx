// Application shell: fixed dark sidebar (role-aware, grouped nav) + top bar +
// routed content area. Wraps every authenticated page. Responsive: the sidebar
// collapses to a slide-over on small screens (Web & Mobile ESS).
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";
import { initials, titleCase } from "../lib/format";

interface NavItem {
  to: string;
  label: string;
  roles?: Role[]; // undefined = all roles
  end?: boolean;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { to: "/", label: "Dashboard", end: true },
      { to: "/ess", label: "My Space" },
    ],
  },
  {
    title: "People",
    items: [{ to: "/employees", label: "Employee Directory" }],
  },
  {
    title: "Payroll",
    items: [
      { to: "/payroll", label: "Payroll Runs", roles: ["admin", "hr"] },
      { to: "/payroll/reconciliation", label: "Reconciliation", roles: ["admin", "hr"] },
      { to: "/payslips", label: "Payslips" },
    ],
  },
  {
    title: "Leave",
    items: [
      { to: "/leave/apply", label: "Apply for Leave" },
      { to: "/leave/approve", label: "Leave Approvals", roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    title: "Claims & Benefits",
    items: [
      { to: "/claims", label: "My Claims" },
      { to: "/claims/approve", label: "Claim Approvals", roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    title: "Performance",
    items: [
      { to: "/performance/goals", label: "Goals & Check-ins" },
      { to: "/performance/reviews", label: "Reviews & Ratings", roles: ["admin", "hr", "manager"] },
      { to: "/performance/history", label: "History & Ranking" },
    ],
  },
  {
    title: "Lifecycle",
    items: [
      { to: "/onboarding", label: "Onboarding", roles: ["admin", "hr", "manager"] },
      { to: "/offboarding", label: "Offboarding", roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    title: "Recruitment",
    items: [
      { to: "/recruitment", label: "Requisitions", roles: ["admin", "hr", "manager"] },
      { to: "/recruitment/candidates", label: "Candidate Pipeline", roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    title: "Learning",
    items: [{ to: "/learning", label: "Training & Certs" }],
  },
  {
    title: "Time & Attendance",
    items: [{ to: "/attendance", label: "Shifts & Overtime" }],
  },
  {
    title: "Insights",
    items: [
      { to: "/reports", label: "Reports", roles: ["admin", "hr"] },
      { to: "/reports/builder", label: "Report Builder", roles: ["admin", "hr"] },
      { to: "/alerts", label: "Workflow Alerts", roles: ["admin", "hr", "manager"] },
    ],
  },
  {
    title: "Governance",
    items: [{ to: "/admin", label: "Administration", roles: ["admin"] }],
  },
];

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function doLogout() {
    logout();
    navigate("/login");
  }

  const visibleGroups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role))),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-ink text-white transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal font-display text-sm font-bold">
            M
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold">Meridian HR</p>
            <p className="text-[11px] text-white/50">People Operations</p>
          </div>
        </div>
        <nav className="h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
          {visibleGroups.map((g) => (
            <div key={g.title} className="mb-4">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                {g.title}
              </p>
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive ? "nav-item-active" : ""}`}
                >
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Backdrop for mobile */}
      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-lg border border-line p-2 text-ink-muted lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            ☰
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-ink">{user?.name}</p>
              <p className="text-xs text-ink-muted">
                {titleCase(user?.role)}
                {hasRole("admin") ? "" : ""}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-soft text-sm font-semibold text-teal-dark">
              {initials(user?.name?.split(" ")[0], user?.name?.split(" ")[1])}
            </div>
            <button onClick={doLogout} className="btn-ghost btn-sm" title="Sign out">
              Sign out
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
