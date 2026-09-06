import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./tokens.css";
import { AppLayout } from "./App";
import { WatchPage } from "./pages/Watch";
import { ScansPage } from "./pages/Scans";
import { CustomersPage } from "./pages/Customers";
import { NotFoundPage } from "./pages/NotFound";

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <WatchPage /> },
      { path: "scans", element: <ScansPage /> },
      { path: "customers", element: <CustomersPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

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
