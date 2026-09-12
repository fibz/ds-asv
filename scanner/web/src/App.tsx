import { Outlet } from "react-router-dom";
import { Rail } from "./components/Rail";
import { TopBar } from "./components/TopBar";

/** App layout: left Rail + top bar + content slot (spec §3.1/§5.3). */
export function AppLayout() {
  return (
    <div className="flex h-full min-h-screen bg-surface text-primary">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
