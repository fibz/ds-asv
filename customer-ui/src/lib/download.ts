// customer-ui/src/lib/download.ts
//
// Client-side saves. There is no GET endpoint for an issued authorisation, so
// the only way to keep the evidence is to build the file from the data the
// issue response already returned — no extra server round trip, no new route.

/**
 * `authorisation-{scopeSetName}-v{n}.json`, with anything outside
 * [a-zA-Z0-9._-] collapsed to a dash so a scope name with spaces or slashes
 * cannot produce an odd filename. An empty stem falls back to "scope" rather
 * than a nameless file.
 */
export function authorizationFilename(scopeSetName: string, versionNumber: number): string {
  const slug = scopeSetName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `authorisation-${slug || "scope"}-v${versionNumber}.json`;
}

/** Save `data` as pretty-printed JSON under `filename`, then release the blob URL. */
export function saveJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
