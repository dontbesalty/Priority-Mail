# Feature Plan: Running Task List

## Overview
This feature allows users to bridge the gap between AI-driven task suggestions in emails and a persistent, actionable task list. Currently, the AI identifies tasks from emails and shows them as "Suggested Tasks" on the email detail page, but these suggestions are ephemeral. This plan introduces a persistent task management system within Priority Mail.

---

## Core Components

### 1. Persistent Storage (PostgreSQL)
A new `tasks` table to store collected tasks.
- Links to the originating email (optional, for traceability)
- Tracks status (Open vs. Done)
- Stores title and due dates

### 2. Backend API Extensions
New REST endpoints to manage the lifecycle of a task.
- `GET /tasks`: List and filter tasks
- `POST /tasks`: Create a new task (manually or from an email)
- `PATCH /tasks/:id`: Toggle status or update details
- `DELETE /tasks/:id`: Remove tasks

### 3. Frontend Interactivity
- **"Add to Task List"** button on the Email Detail page.
- A new **/tasks** route for managing the running list.
- Global navigation link to access the list from any page.

---

## Implementation Details

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  email_id     TEXT REFERENCES emails(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### API Routes (`/tasks`)
- `GET /tasks?status=open|done`: Returns tasks sorted by due date.
- `POST /tasks`: Body `{ email_id?, title, due_date? }`.
- `PATCH /tasks/:id`: Body `{ status?, title? }`.
- `DELETE /tasks/:id`: Deletes the task.

### UI/UX Flow
1. **Discovery**: User opens an email with a "Suggested Task".
2. **Collection**: User clicks "Add to Task List". The button provides immediate feedback (e.g., "Added ✓").
3. **Management**: User navigates to the "Task List" from the sidebar/nav.
4. **Action**: User checks off tasks as complete or deletes them.
5. **Traceability**: User can click a link on the task to go back to the original email.

---

## Success Criteria
- [ ] Users can successfully add a suggested task from an email to the list.
- [ ] Tasks persist across server restarts (DB storage).
- [ ] The task list accurately reflects the count of open/done tasks.
- [ ] Navigation remains intuitive with the addition of the new list.

---

## Future Considerations (Phase 2 & 3)
- Inline editing of task titles.
- Manual task creation (not from email).
- External sync with Todoist, Linear, or Notion.
- Slack/Email notifications for overdue tasks.
