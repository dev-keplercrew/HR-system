import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import Login from "../pages/Login";
import ProtectedRoute from "../components/ProtectedRoute";

function renderAt(ui: React.ReactNode, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe("auth smoke", () => {
  beforeEach(() => localStorage.clear());

  it("renders the Login page with a sign-in form", () => {
    renderAt(<Login />, "/login");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("shows demo account shortcuts", () => {
    renderAt(<Login />, "/login");
    expect(screen.getByText(/admin@meridian\.sg/i)).toBeInTheDocument();
  });

  it("blocks a protected route when unauthenticated", () => {
    renderAt(
      <ProtectedRoute>
        <div>secret content</div>
      </ProtectedRoute>,
      "/employees"
    );
    // Unauthenticated → ProtectedRoute redirects (Navigate), secret content never renders.
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });
});
