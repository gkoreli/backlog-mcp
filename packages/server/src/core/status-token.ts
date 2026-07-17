/**
 * Status token normalization — single rule, one home.
 *
 * The implementation lives in @backlog-mcp/shared so the search package
 * (BUG-0003: declared-substrate status filtering) applies the exact same
 * leading-token rule as the wakeup/list disclosure seams. This module
 * remains the server-side import path; it must never fork the rule.
 */
export { statusToken, matchesDeclaredStatus } from '@backlog-mcp/shared';
