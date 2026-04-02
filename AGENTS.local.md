# Completion Checklist

Before committing or telling the user a task is complete:

1. Run `make check` — this mirrors CI and covers formatting, lint, type-check, tests, and build. Fix any failures before proceeding.
2. If `make check` fails on formatting, run `npx prettier --write .` — this applies to **all** changed files including `.md` files.
3. Call the `/e2e-check` skill to run end-to-end checks.
