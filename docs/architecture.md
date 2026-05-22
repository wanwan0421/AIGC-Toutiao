# Architecture Draft

## Product Shape

This project is one platform with two core scenarios:

- Creator workflow: create, generate, edit, autosave, audit, score, publish, update.
- Reader workflow: browse rankings, open content details, generate engagement signals.

## Content Lifecycle

```text
draft -> pending_review -> approved -> published -> updated / offline
draft -> pending_review -> rejected -> rewritten -> pending_review
```

## Backend Modules

- Auth: register, login, logout, session.
- Users: profile and creator preferences.
- Contents: articles, status transitions, publishing.
- Drafts: autosave, recovery, conflict metadata.
- Prompts: prompt templates, scenes, versions.
- Assets: uploaded material metadata and compliance status.
- AI: generation, audit, quality score, compliant rewrite.
- Moderation: audit records and intervention decisions.
- Rankings: hot, viral, recommended lists.
- Analytics: view, click, like, collect, expose events.

## Storage Split

PostgreSQL is the source of truth for durable business data.

Redis is the realtime layer for sessions, token blacklist, ranking ZSets, counters, rate limits, task states, and temporary autosave cache. Redis values that matter to product recovery are flushed back to PostgreSQL by scheduled jobs or event handlers.
