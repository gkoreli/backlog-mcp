/**
 * Mutating control routes (`/api/restart`, `/shutdown`) accept only same-
 * machine callers (ADR 0131 R5). The listener is loopback-bound, but the
 * permissive CORS middleware would let any web page POST here; the browser
 * always stamps a cross-site request with its `Origin`, so a present,
 * non-loopback origin is the tell. Absent origin = curl/CLI on this machine.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu;

export function isLoopbackOrigin(origin: string | undefined): boolean {
  return origin === undefined || LOOPBACK_ORIGIN.test(origin);
}
