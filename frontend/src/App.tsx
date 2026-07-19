// Central route registry (single owner per the seam contract). Pages are built
// standalone by their module and registered HERE only.
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import type { Role } from "./context/AuthContext";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EssDashboard from "./pages/EssDashboard";
import EmployeeDirectory from "./pages/EmployeeDirectory";
import EmployeeProfile from "./pages/EmployeeProfile";
import Payroll from "./pages/Payroll";
import Payslips from "./pages/Payslips";
import LeaveApplication from "./pages/LeaveApplication";
import LeaveApproval from "./pages/LeaveApproval";
import ClaimsSubmission from "./pages/ClaimsSubmission";
import ClaimsApproval from "./pages/ClaimsApproval";
import Reports from "./pages/Reports";
import ReportBuilder from "./pages/ReportBuilder";
import WorkflowAlerts from "./pages/WorkflowAlerts";
import Admin from "./pages/Admin";
import PerformanceGoals from "./pages/PerformanceGoals";
import PerformanceReview from "./pages/PerformanceReview";
import PerformanceHistory from "./pages/PerformanceHistory";
import Onboarding from "./pages/Onboarding";
import Offboarding from "./pages/Offboarding";
import Recruitment from "./pages/Recruitment";
import CandidatePipeline from "./pages/CandidatePipeline";
import Learning from "./pages/Learning";
import TimeAttendance from "./pages/TimeAttendance";

const HR = ["admin", "hr"] as Role[];
const MGR = ["admin", "hr", "manager"] as Role[];
const ADMIN = ["admin"] as Role[];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="ess" element={<EssDashboard />} />
        <Route path="employees" element={<EmployeeDirectory />} />
        <Route path="employees/:id" element={<EmployeeProfile />} />

        <Route path="payroll" element={<ProtectedRoute roles={HR}><Payroll /></ProtectedRoute>} />
        <Route path="payslips" element={<Payslips />} />

        <Route path="leave/apply" element={<LeaveApplication />} />
        <Route path="leave/approve" element={<ProtectedRoute roles={MGR}><LeaveApproval /></ProtectedRoute>} />

        <Route path="claims" element={<ClaimsSubmission />} />
        <Route path="claims/approve" element={<ProtectedRoute roles={MGR}><ClaimsApproval /></ProtectedRoute>} />

        <Route path="performance/goals" element={<PerformanceGoals />} />
        <Route path="performance/reviews" element={<ProtectedRoute roles={MGR}><PerformanceReview /></ProtectedRoute>} />
        <Route path="performance/history" element={<PerformanceHistory />} />

        <Route path="onboarding" element={<ProtectedRoute roles={MGR}><Onboarding /></ProtectedRoute>} />
        <Route path="offboarding" element={<ProtectedRoute roles={MGR}><Offboarding /></ProtectedRoute>} />

        <Route path="recruitment" element={<ProtectedRoute roles={MGR}><Recruitment /></ProtectedRoute>} />
        <Route path="recruitment/candidates" element={<ProtectedRoute roles={MGR}><CandidatePipeline /></ProtectedRoute>} />

        <Route path="learning" element={<Learning />} />
        <Route path="attendance" element={<TimeAttendance />} />

        <Route path="reports" element={<ProtectedRoute roles={HR}><Reports /></ProtectedRoute>} />
        <Route path="reports/builder" element={<ProtectedRoute roles={HR}><ReportBuilder /></ProtectedRoute>} />
        <Route path="alerts" element={<ProtectedRoute roles={MGR}><WorkflowAlerts /></ProtectedRoute>} />

        <Route path="admin" element={<ProtectedRoute roles={ADMIN}><Admin /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
