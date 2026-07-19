// Route guard. Redirects unauthenticated users to /login and blocks users whose
// role is not permitted for the wrapped route (shows a 403 panel).
import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";
import { Loading } from "./ui";

export default function ProtectedRoute({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card-pad mx-auto mt-16 max-w-md text-center">
        <h2 className="text-lg font-semibold text-ink">Access restricted</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Your role ({user.role}) does not have permission to view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
