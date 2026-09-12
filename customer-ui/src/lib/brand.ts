/**
 * The customer-facing product name.
 *
 * PLACEHOLDER — the real brand is not decided yet (design spec §14, open item 4:
 * "the customer-facing product name is unconfirmed"). It is deliberately neutral
 * because a guess rendered in the chrome stops looking like a guess and starts
 * looking like a decision, which is what happened when "T3MP3ST" was hardcoded
 * here during the build.
 *
 * Render this constant; never inline the string. `brand.test.ts` enforces that.
 */
export const PRODUCT_NAME = "ASV Portal";

/** The short descriptor shown under the wordmark. */
export const PRODUCT_TAGLINE = "Payment security portal";
