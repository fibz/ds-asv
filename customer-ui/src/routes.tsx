import { Home } from "./screens/Home";
import { Assets } from "./screens/Assets";
import { Scope } from "./screens/Scope";
import { Scans } from "./screens/Scans";
import { Reports } from "./screens/Reports";
import { ReportDetail } from "./screens/ReportDetail";
import { SignInLanding } from "./screens/SignInLanding";
import { Placeholder } from "./screens/Placeholder";

export const routes = [
  { path: "/sign-in", element: <SignInLanding />, chrome: false },
  { path: "/", element: <Home />, chrome: true },
  { path: "/assets", element: <Assets />, chrome: true },
  { path: "/assets/new", element: <Placeholder title="Add asset" pass="second pass" />, chrome: true },
  { path: "/assets/import", element: <Placeholder title="Import assets" pass="second pass" />, chrome: true },
  { path: "/scope", element: <Scope />, chrome: true },
  { path: "/scans", element: <Scans />, chrome: true },
  { path: "/reports", element: <Reports />, chrome: true },
  { path: "/reports/:reportId", element: <ReportDetail />, chrome: true },
  { path: "/team", element: <Placeholder title="Team" pass="second pass" />, chrome: true },
  { path: "/access", element: <Placeholder title="Access" pass="second pass" />, chrome: true },
  { path: "/audit", element: <Placeholder title="Audit" pass="second pass" />, chrome: true },
  { path: "/settings", element: <Placeholder title="Settings" pass="second pass" />, chrome: true },
];
