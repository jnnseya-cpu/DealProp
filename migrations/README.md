# Migrations

The base schema in `postgresStore.ts` creates every table with
`CREATE TABLE IF NOT EXISTS` and is **additive only**. Adding a table or a
column that starts empty needs nothing here — add it there and it appears on
the next connection.

This directory is for the changes that additive DDL cannot express: a column
that has to change shape, data that has to be backfilled, an index that has to
be rebuilt, a constraint that has to be added to a table that already has rows
violating it.

## How it runs

Files are applied in filename order, once each, inside a transaction, and
recorded in `schema_migrations`. A file that has already run is skipped. A file
that fails rolls back and stops the process — a half-applied migration is worse
than an unapplied one, and continuing past a failure is how the two get
confused.

Name them `NNN-what-it-does.sql`, zero-padded:

```
migrations/001-split-seller-name.sql
```

## Rules

**Never edit a file that has run.** It will not run again, so editing it
changes what the repository says happened without changing what happened. Add
a new file.

**Take a backup first.** `npm run backup`, and restore it into a scratch
database before you rely on it — a backup nobody has restored is a hypothesis.

**Write the down migration in the file as a comment**, even though nothing
runs it. At three in the morning the useful thing is not an automated
rollback, it is the previous author having written down what they would undo.
