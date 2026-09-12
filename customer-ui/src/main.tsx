// customer-ui/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { sessionExpiryRedirect } from "./lib/auth/session-expiry";
import "./styles/app.css";

/**
 * Build the app's single QueryClient.
 *
 * Exported so the session-expiry wiring is proven against the REAL client -
 * a test must not rebuild a look-alike config and call that coverage.
 *
 * `queryCache.onError` is the one place a failed query is observed across every
 * screen: a 401 means the session is gone, so a retry can never succeed and the
 * browser is sent to the sign-in landing instead of looping on a dead retry.
 * The base comes from Vite (`import.meta.env.BASE_URL` = `/app/`), never a
 * hardcoded prefix.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
    queryCache: new QueryCache({
      onError: (error) => {
        const target = sessionExpiryRedirect(error, import.meta.env.BASE_URL);
        if (target) window.location.replace(target);
      },
    }),
  });
}

const queryClient = createQueryClient();

// Guarded so importing this module (e.g. from a test) mounts nothing.
const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/app">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}
