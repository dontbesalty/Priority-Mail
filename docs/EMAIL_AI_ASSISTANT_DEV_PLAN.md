# AI Email Triage Assistant - Development Plan

## Recommended Stack

### Frontend
- React
- TypeScript
- Next.js

### Backend
- Node.js
- TypeScript

### Database
- PostgreSQL

### Queue / Background Jobs
- Redis
- BullMQ

### AI Layer
- OpenRouter API

### Email Provider APIs
- Microsoft Graph API
- Gmail API

---

## Recommended Architecture

```text
[ Email Client / Dashboard ]
            |
            v
[ Backend API ]
            |
            v
[ AI Service Layer ] ---> OpenRouter
            |
            v
[ PostgreSQL + Redis ]
```

## Main Components

### Mail Connector Service
- Authenticate mailbox
- Pull unread emails
- Normalize email format
- Remove signatures and quoted history

### AI Classification Service
Returns:
- priority
- category
- reply_needed
- task_needed
- task_title
- due_date_guess
- reply_draft
- confidence

### Rules Engine
Hard-coded rules before AI:
- VIP sender = high priority
- Invoice subject = billing
- Internal domain = internal
- Newsletters = low priority

### Suggested Development Phases

#### Phase 1 — Mail Reading MVP
- Login
- Connect Outlook mailbox
- Read unread emails
- Show raw email list

#### Phase 2 — AI Triage MVP
- OpenRouter integration
- Prompt templates
- Parse AI responses
- Show priority and category

#### Phase 3 — Task + Reply Suggestions
- Task extraction
- Reply generation
- Editable draft reply

#### Phase 4 — Feedback Learning
- Let users correct classifications
- Save corrections
- Improve prompts and rules

#### Phase 5 — Production Features
- Multi-provider support
- Shared mailboxes
- Daily digest
- Team features
