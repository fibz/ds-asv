import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./tokens.css";
import { AppLayout } from "./App";
import { HomeGate, RequireAuth, RequireRole } from "./auth/guard";
import { CustomerDetailPage } from "./pages/CustomerDetail";
import { CustomersPage } from "./pages/Customers";
import { LoginPage } from "./pages/Login";
import { NotFoundPage } from "./pages/NotFound";
import { ScanDetailPage } from "./pages/ScanDetail";
import { ScansPage } from "./pages/Scans";

const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <HomeGate /> },
        { path: "scans", element: <ScansPage /> },
        { path: "scans/:scanId", element: <ScanDetailPage /> },
        {
          path: "customers",
          element: (
            <RequireRole role="operator">
              <CustomersPage />
            </RequireRole>
          ),
        },
        {
          path: "customers/:customerId",
          element: (
            <RequireRole role="operator">
              <CustomerDetailPage />
            </RequireRole>
          ),
        },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  // Base path the app is served from (/scanner/ in production, / in dev and
  // tests). Without this every <Link to="/scans"> would escape the prefix.
  { basename: import.meta.env.BASE_URL }
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
