/** Additive diagnostics for a committed authoritative write; never stored in entities. */
export interface WriteWarning {
  code: 'index_repair_pending' | 'journal_append_failed' | 'notification_failed';
  message: string;
}
