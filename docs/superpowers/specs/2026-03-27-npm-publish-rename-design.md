# Design: Rename package to `@stellar/mpp` for npm publication

**Date:** 2026-03-27
**Status:** Approved

## Goal

Prepare the repository for public npm publication as `@stellar/mpp`, replacing the current internal name `stellar-mpp-sdk`.

## package.json changes

| Field           | Before              | After                                                                                                                                                     |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | `"stellar-mpp-sdk"` | `"@stellar/mpp"`                                                                                                                                          |
| `publishConfig` | _(absent)_          | `{"access": "public"}`                                                                                                                                    |
| `repository`    | _(absent)_          | `{"type": "git", "url": "git+https://github.com/stellar/stellar-mpp-sdk.git"}`                                                                            |
| `keywords`      | _(absent)_          | `["stellar", "blockchain", "payments", "mpp", "machine-payments", "soroban", "payment-channels", "typescript", "sdk", "402", "agentic-payments", "mppx"]` |

`publishConfig.access: "public"` is required — scoped npm packages default to private and will be rejected without it.

No `homepage` field is added.

## Reference updates

All occurrences of `stellar-mpp-sdk` renamed to `@stellar/mpp` in:

| File                                | Nature of change                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `README.md`                         | Install command, all import examples in code blocks, and prose references in the "Breaking changes" section |
| `CLAUDE.md`                         | Module map table, subpath exports section, import examples                                                  |
| `sdk/src/charge/client/Charge.ts`   | JSDoc comment import example                                                                                |
| `sdk/src/channel/client/Channel.ts` | JSDoc comment import example                                                                                |
| `sdk/src/channel/server/Channel.ts` | JSDoc comment import example                                                                                |
| `sdk/src/channel/server/State.ts`   | JSDoc comment import example                                                                                |
| `sdk/src/channel/server/Watcher.ts` | JSDoc comment import example                                                                                |
| `demo/index.html`                   | Cosmetic branding text                                                                                      |
| `demo/output-run.txt`               | Terminal prompt in sample output                                                                            |

## Out of scope

- No changes to version, description, engines, exports, files, scripts, or dependencies
- No changes to source logic
- No `.npmignore` needed (`files: ["dist"]` already limits what gets published)
