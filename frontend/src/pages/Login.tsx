// Login — split brand panel + sign-in form with one-click demo role logins.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button, Field, Input } from "../components/ui";

const DEMO = [
  { role: "Admin", email: "admin@meridian.sg" },
  { role: "HR", email: "hr@meridian.sg" },
  { role: "Manager", email: "manager@meridian.sg" },
  { role: "Employee", email: "employee@meridian.sg" },
];
const DEMO_PASSWORD = "password123";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@meridian.sg");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-label="Singapore Red Cross">
              <path fill="#ED1B2E" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
            </svg>
          </div>
          <span className="font-display text-lg font-semibold">Singapore Red Cross</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight">
            People operations, unified.
          </h1>
          <p className="mt-4 text-white/60">
            Employee records, Singapore payroll (CPF/IRAS/GIRO), leave, claims, performance,
            recruitment and more — one governed platform for ~350 people.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Payroll · CPF", "Leave", "Claims", "Performance", "Recruitment", "Analytics"].map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                {t}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-white/40">
          Demo environment — statutory calculations are simulated, not certified.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-label="Singapore Red Cross">
              <path fill="#ED1B2E" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
            </svg>
            <span className="font-display text-xl font-semibold text-ink">Singapore Red Cross</span>
          </div>
          <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-muted">Access your HR workspace.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error && <p className="text-sm text-bad">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Demo accounts (password: {DEMO_PASSWORD})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs hover:border-teal"
                >
                  <span className="block font-medium text-ink">{d.role}</span>
                  <span className="block truncate text-ink-muted">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
