# AI Email Triage Assistant

## Overview

An email assistant that reads incoming emails and helps a human user decide:
- Which emails need attention first
- Which emails require a reply
- Which emails should become tasks
- Which emails can be ignored, archived, or deferred

The system should not automatically send replies or perform actions initially. Instead, it should recommend actions and allow the user to approve them.

---

## Core Value Proposition

Most users spend too much time:
- Reading unimportant emails
- Deciding what is urgent
- Manually converting emails into tasks
- Writing repetitive replies

The assistant solves this by turning each email into:
- A priority level
- A recommended action
- A suggested task (if needed)
- A draft response

---

## Main Features

### Inbox Prioritization
- High / Medium / Low priority
- Urgent vs informational
- Why it was prioritized

### Email Categorization
- Client Request
- Internal Team
- Billing / Invoice
- Sales Lead
- Support Issue
- Waiting On Someone Else
- Newsletter / Marketing
- Spam / Low Importance

### Task Extraction
The assistant identifies:
- Task title
- Due date if implied
- Person responsible
- Suggested next step

### Suggested Replies
The assistant can generate:
- Short reply
- Professional reply
- Friendly reply
- Detailed reply

---

## Product Scope

### Phase 1 — Simple MVP
- One mailbox per user
- Read unread emails
- Classify each email
- Generate a suggested reply
- Extract tasks
- No automatic sending

### Phase 2 — Smart Inbox
- Rank unread emails by importance
- Daily summary
- Group emails by category
- Follow-up reminders

### Phase 3 — Workflow Assistant
- Create tasks in external apps
- Calendar suggestions
- CRM integration
- Shared mailbox support

---

## Guiding Principles
- AI recommends, human approves
- Keep explanations visible
- Avoid fully automatic actions initially
- Use rules + AI together
- Learn from user corrections over time
