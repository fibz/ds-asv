import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuth } from "../auth/store";
import { Rail } from "./Rail";

const initial = {
  token: null,
  role: null,
  customerId: null,
  customerName: null,
  notice: null,
} as const;

beforeEach(() => {
  localStorage.clear();
  useAuth.setState(initial);
});

function renderRail() {
  return render(
    <MemoryRouter initialEntries={["/scans"]}>
      <Rail />
    </MemoryRouter>
  );
}

describe("Rail role-gated navigation (spec §2/§3.1)", () => {
  it("shows Watch, Scans and Customers to operators", () => {
    useAuth.setState({ token: "t", role: "operator" });
    renderRail();
    expect(screen.getByRole("link", { name: "Watch" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Customers" })).toBeInTheDocument();
  });

  it("shows only Scans to a QSA", () => {
    useAuth.setState({
      token: "t",
      role: "qsa",
      customerId: "cust-1",
      customerName: "Acme Co",
    });
    renderRail();
    expect(screen.getByRole("link", { name: "Scans" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Customers" })).not.toBeInTheDocument();
  });
});
