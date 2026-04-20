# Feature: Dynamic Email Retention (Cleanup Process)

## Overview
To keep the database lean while preserving important communications, a background cleanup process purges emails based on their priority level.

## Design Decisions
- **Retention Policy**:
  - **Low Priority**: 48 hours.
  - **Medium Priority**: 1 week.
  - **High Priority**: 1 month.
  - **Unclassified**: 48 hours.
- **Mechanism**: Background interval in the Express backend.
- **Frequency**: Runs once every hour.
- **Impact on Tasks**: Associated tasks will have their `email_id` set to `NULL` (via `ON DELETE SET NULL` in schema), preserving the task title and status while freeing up storage from the email body.
- **Observability**: Each cleanup run logs the total number of deleted records to the `logs` table.

## Implementation Plan

### 1. Backend Utility
`backend/src/db/cleanup.ts` handles the priority-based deletion using a logic query.

```sql
DELETE FROM emails 
WHERE 
  (priority = 'Low' AND received_at < NOW() - INTERVAL '48 hours') OR
  (priority = 'Medium' AND received_at < NOW() - INTERVAL '1 week') OR
  (priority = 'High' AND received_at < NOW() - INTERVAL '1 month') OR
  (priority IS NULL AND received_at < NOW() - INTERVAL '48 hours')
```

### 2. Server Integration
Initialized in `backend/src/server.ts` to run on startup and hourly.

## Success Criteria
- [x] Database purges emails according to priority-specific retention windows.
- [x] System logs show the cleanup activity every hour if emails were deleted.
- [x] Tasks remain intact after their source email is deleted.
