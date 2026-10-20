/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/**
 * GitHub's rate limit: every further request fails too, so a scan stops at once; reading an
 * organization's skills stops instead, and the listing is kept.
 */
export class RateLimitError extends AtlasError {}
