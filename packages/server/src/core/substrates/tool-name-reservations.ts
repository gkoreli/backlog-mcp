const TOOL_NAME_RESERVATION_STATUS = {
  backlog_list: 'active',
  backlog_get: 'active',
  backlog_create: 'retired',
  backlog_update: 'retired',
  backlog_delete: 'active',
  backlog_search: 'active',
  backlog_wakeup: 'active',
  backlog_recall: 'active',
  backlog_remember: 'active',
  backlog_forget: 'active',
  backlog_consolidation_candidates: 'active',
  backlog_contradictions: 'active',
  write_resource: 'active',
} as const satisfies Record<string, 'active' | 'retired'>;

function namesWithStatus(status: 'active' | 'retired'): string[] {
  return Object.entries(TOOL_NAME_RESERVATION_STATUS)
    .filter(function hasStatus(entry) {
      return entry[1] === status;
    })
    .map(function getName(entry) {
      return entry[0];
    })
    .sort();
}

/** Static MCP tools that the server currently registers. */
export const STATIC_TOOL_NAMES = namesWithStatus('active');

/** Every server-owned MCP name, including tombstones that cannot be reclaimed. */
export const RESERVED_TOOL_NAMES = Object.keys(TOOL_NAME_RESERVATION_STATUS).sort();
