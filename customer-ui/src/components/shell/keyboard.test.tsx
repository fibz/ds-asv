// customer-ui/src/components/shell/keyboard.test.tsx
//
// Guard rail: the whole shell is reachable with the keyboard alone, in the
// order the eye reads it. Tab must land on the four lifecycle links in order
// (Assets → Scope → Scans → Reports) and, after the Manage group, on the
// sign-out control. Nothing here is mouse-dependent.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { LifecycleNav } from "./LifecycleNav";
import { stageRows } from "../../lib/viewmodels/stages";

const stages = stageRows({
  assets: [], approved: null, hasDraftScope: false,
  scans: [], reports: [], finalReportIds: [],
});

const renderNav = () => render(<MemoryRouter><LifecycleNav stages={stages} /></MemoryRouter>);

describe("LifecycleNav keyboard traversal", () => {
  it("reaches the four lifecycle links in order with Tab alone", async () => {
    const user = userEvent.setup();
    renderNav();

    const order = [
      screen.getByRole("link", { name: /Assets/ }),
      screen.getByRole("link", { name: /Scope/ }),
      screen.getByRole("link", { name: /Scans/ }),
      screen.getByRole("link", { name: /Reports/ }),
    ];

    for (const link of order) {
      await user.tab();
      expect(link).toHaveFocus();
    }
  });

  it("reaches the sign-out control from the keyboard, after the nav links", async () => {
    const user = userEvent.setup();
    renderNav();

    const signOut = screen.getByRole("button", { name: /Sign out/i });

    // Bounded walk: four lifecycle links, four Manage links, then the form
    // control. Stop as soon as focus lands on sign-out.
    for (let i = 0; i < 12 && document.activeElement !== signOut; i++) {
      await user.tab();
    }

    expect(signOut).toHaveFocus();
    // It is a real submit inside the POST form (a plain link would 405).
    expect(signOut.closest("form")).toHaveAttribute("method", "post");
  });
});
