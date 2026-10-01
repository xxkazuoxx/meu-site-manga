# SQLite schema migrations

`schema_migrations` records applied schema versions. The comment schema is
initialized directly in its canonical form on a new database and migration
version 1 upgrades existing comment tables to the same contract:

- `author_name` is the author field returned by the API and consumed by the UI.
- `status` is `visible` or `offensive`, defaulting to `visible`.
- `created_at` and `updated_at` are present and non-null.
- `parent_id` retains its self-reference and cascading delete behavior.

Version 1 maps legacy `name` to `author_name`. Legacy `pending` statuses become
`visible`: the public endpoint historically returned every comment without a
pending-state filter, and both the admin moderation route and UI only support
`visible`/`offensive`. Existing `visible` and `offensive` values are preserved.
Unknown status values stop the migration before the comments table is changed;
they are not silently discarded or guessed.

The migration preserves comment IDs, text, manga/chapter fields, valid
timestamps, parent links, extra columns, indexes, and triggers. Any migration
that fails its row-count or foreign-key checks rolls back transactionally.
