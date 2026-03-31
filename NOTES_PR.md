# Draft Pull Request

**Base branch:** main

## Title

docs: fix CHANGELOG entries for v0.3.0

## What

- Move PR #34 (`feePayer` channel signer refactor) from `[Unreleased]` into the `0.3.0 / Changed` section where it belongs
- Add missing PR #35 (draft-stellar-charge-00 spec references) under a new `0.3.0 / Added` section

## Why

The last two commits landed on `main` after the `0.3.0` changelog section was drafted, leaving #34 stranded under `[Unreleased]` and #35 absent entirely. This PR corrects the record so the changelog accurately reflects the full 0.3.0 release.
