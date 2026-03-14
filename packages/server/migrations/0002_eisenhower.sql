-- ============================================================================
-- backlog-mcp D1 migration 0002 — Eisenhower Matrix columns (ADR-0084)
-- ============================================================================

ALTER TABLE tasks ADD COLUMN urgency    INTEGER;
ALTER TABLE tasks ADD COLUMN importance INTEGER;
