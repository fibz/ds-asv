import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; the app reads it for
// prefers-reduced-motion (spec §4.5). Provide a default (non-reduced) stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom lacks scrollTo used by nothing critical, but keep Navigation happy.
if (!window.scrollTo) {
  window.scrollTo = () => undefined;
}
