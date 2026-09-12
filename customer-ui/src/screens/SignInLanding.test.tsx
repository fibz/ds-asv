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
    // The login URL must carry a returnTo so the portal sends the user back to
    // this app instead of its own UI. The value follows BASE_URL, which is "/"
    // under vitest and "/app/" in the built app — so assert the shape, and that
    // it is a rooted local path (the portal rejects anything else).
    const href = links[0].getAttribute("href") ?? "";
    expect(href.startsWith("/api/auth/login?returnTo=")).toBe(true);
    expect(decodeURIComponent(href.split("returnTo=")[1] ?? "").startsWith("/")).toBe(true);
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
