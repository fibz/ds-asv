import { Link } from "react-router-dom";

/** 404 fallback. */
export function NotFoundPage() {
  return (
    <section aria-label="Not found" className="flex flex-col items-center py-24">
      <p className="font-mono text-muted">404</p>
      <h1 className="mt-2 font-display text-xl font-semibold text-primary">
        Page not found
      </h1>
      <Link to="/" className="mt-4 text-sm text-accent hover:underline">
        Go home
      </Link>
    </section>
  );
}
