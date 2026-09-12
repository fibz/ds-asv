// customer-ui/src/screens/SignInLanding.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SignInLanding } from "./SignInLanding";

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><SignInLanding /></MemoryRouter>);

describe("SignInLanding", () => {
  it("offers exactly one action: continue with Keycloak", () => {
    renderAt("/sign-in");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/api/auth/login");
  });

  it("has no password field", () => {
    renderAt("/sign-in");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("explains an expired session instead of showing a raw 401", () => {
    renderAt("/sign-in?reason=expired");
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it("explains a signed-out state plainly", () => {
    renderAt("/sign-in?reason=signed-out");
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
  });
});
