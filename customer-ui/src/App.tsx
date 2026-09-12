import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { routes } from "./routes";

export default function App() {
  return (
    <Routes>
      {routes
        .filter((r) => !r.chrome)
        .map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      {routes
        .filter((r) => r.chrome)
        .map((r) => (
          <Route key={r.path} path={r.path} element={<AppShell>{r.element}</AppShell>} />
        ))}
    </Routes>
  );
}
