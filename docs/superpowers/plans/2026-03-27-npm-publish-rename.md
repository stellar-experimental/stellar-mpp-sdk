# npm Package Rename Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the package from `stellar-mpp-sdk` to `@stellar/mpp` and add npm publication metadata so it can be published publicly with `npm publish`.

**Architecture:** Pure rename — no logic changes. Update `package.json` with the new name and publication metadata, then replace every string occurrence of `stellar-mpp-sdk` with `@stellar/mpp` across source, docs, and demo files.

**Tech Stack:** Node.js / TypeScript, pnpm, npm registry.

---

## Files Modified

| File                                | Change                                                |
| ----------------------------------- | ----------------------------------------------------- |
| `package.json`                      | Rename, add `publishConfig`, `repository`, `keywords` |
| `README.md`                         | All `stellar-mpp-sdk` occurrences → `@stellar/mpp`    |
| `CLAUDE.md`                         | All `stellar-mpp-sdk` occurrences → `@stellar/mpp`    |
| `sdk/src/charge/client/Charge.ts`   | JSDoc comment import example                          |
| `sdk/src/channel/client/Channel.ts` | JSDoc comment import example                          |
| `sdk/src/channel/server/Channel.ts` | JSDoc comment import example                          |
| `sdk/src/channel/server/State.ts`   | JSDoc comment import example                          |
| `sdk/src/channel/server/Watcher.ts` | JSDoc comment import example                          |
| `demo/index.html`                   | Cosmetic branding text                                |
| `demo/output-run.txt`               | Terminal prompt in sample output                      |

---

### Task 1: Update `package.json`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Edit `package.json`**

  Apply the following changes:

  ```json
  {
    "name": "@stellar/mpp",
    "publishConfig": {
      "access": "public"
    },
    "repository": {
      "type": "git",
      "url": "git+https://github.com/stellar/stellar-mpp-sdk.git"
    },
    "keywords": [
      "stellar",
      "blockchain",
      "payments",
      "mpp",
      "machine-payments",
      "soroban",
      "payment-channels",
      "typescript",
      "sdk",
      "402",
      "agentic-payments",
      "mppx"
    ]
  }
  ```

  Place `publishConfig` and `repository` after `"license"` and before `"dependencies"`. Place `keywords` after `"repository"`.

- [ ] **Step 2: Verify `package.json` parses correctly**

  Run: `node -e "const p = require('./package.json'); console.log(p.name, p.publishConfig)"`
  Expected: `@stellar/mpp { access: 'public' }`

- [ ] **Step 3: Commit**

  ```bash
  git add package.json
  git commit -m "chore: rename package to @stellar/mpp, add npm publication metadata"
  ```

---

### Task 2: Update `README.md`

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace all occurrences in README.md**

  Replace every instance of `stellar-mpp-sdk` with `@stellar/mpp` throughout the file. This includes:
  - Install command (line ~103): `npm install stellar-mpp-sdk mppx @stellar/stellar-sdk`
  - All import examples in code blocks (e.g. `from 'stellar-mpp-sdk/charge/server'`)
  - The Exports table (lines ~208–217)
  - The "Breaking changes from 0.1.0" section prose references (lines ~415–418)

  Verify count before and after:

  ```bash
  grep -c 'stellar-mpp-sdk' README.md   # should be 0 after edit
  grep -c '@stellar/mpp' README.md       # count should match what was replaced
  ```

- [ ] **Step 2: Spot-check a few key lines**

  Confirm these are correct after editing:
  - Install: `npm install @stellar/mpp mppx @stellar/stellar-sdk`
  - Import example: `import { Mppx, stellar } from '@stellar/mpp/charge/server'`
  - Exports table row: `\`@stellar/mpp\`` (root entry)
  - Breaking changes prose: `Use \`@stellar/mpp/charge/client\` and \`@stellar/mpp/charge/server\``

- [ ] **Step 3: Commit**

  ```bash
  git add README.md
  git commit -m "docs: update README imports and install command to @stellar/mpp"
  ```

---

### Task 3: Update `CLAUDE.md`

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace all occurrences in CLAUDE.md**

  Replace every instance of `stellar-mpp-sdk` with `@stellar/mpp` in `CLAUDE.md`.

  Verify:

  ```bash
  grep -c 'stellar-mpp-sdk' CLAUDE.md   # should be 0 after edit
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add CLAUDE.md
  git commit -m "docs: update CLAUDE.md import references to @stellar/mpp"
  ```

---

### Task 4: Update JSDoc comments in `sdk/src/`

**Files:**

- Modify: `sdk/src/charge/client/Charge.ts`
- Modify: `sdk/src/channel/client/Channel.ts`
- Modify: `sdk/src/channel/server/Channel.ts`
- Modify: `sdk/src/channel/server/State.ts`
- Modify: `sdk/src/channel/server/Watcher.ts`

- [ ] **Step 1: Replace occurrences in all 5 source files**

  Each file has exactly one JSDoc comment line containing `stellar-mpp-sdk` as a package name prefix (the subpath varies per file, e.g. `'stellar-mpp-sdk/channel/server'`, `'stellar-mpp-sdk/client'`).
  Replace the package name prefix in all five files:

  Replace `stellar-mpp-sdk` with `@stellar/mpp` in each file.

  Verify:

  ```bash
  grep -r 'stellar-mpp-sdk' sdk/src/   # should return nothing
  ```

- [ ] **Step 2: Ensure TypeScript still compiles**

  Run: `pnpm run check:types`
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add sdk/src/charge/client/Charge.ts sdk/src/channel/client/Channel.ts \
          sdk/src/channel/server/Channel.ts sdk/src/channel/server/State.ts \
          sdk/src/channel/server/Watcher.ts
  git commit -m "docs: update JSDoc import examples to @stellar/mpp"
  ```

---

### Task 5: Update demo files

**Files:**

- Modify: `demo/index.html`
- Modify: `demo/output-run.txt`

- [ ] **Step 1: Replace occurrences in demo files**
  - `demo/index.html` line ~374: `stellar-mpp-sdk &middot;` → `@stellar/mpp &middot;`
  - `demo/output-run.txt` line 1: `stellar-mpp-sdk %` → `@stellar/mpp %`

  Verify:

  ```bash
  grep -r 'stellar-mpp-sdk' demo/   # should return nothing
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add demo/index.html demo/output-run.txt
  git commit -m "chore: update demo files to @stellar/mpp"
  ```

---

### Task 6: Final verification

- [ ] **Step 1: Confirm zero remaining occurrences**

  ```bash
  grep -r 'stellar-mpp-sdk' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=docs
  ```

  Expected: no output.

- [ ] **Step 2: Run full quality pipeline**

  ```bash
  pnpm test -- --run
  pnpm run check:types
  pnpm run build
  ```

  Expected: all pass with no errors.

- [ ] **Step 3: Verify package contents**

  ```bash
  npm pack --dry-run
  ```

  Expected: output shows `@stellar/mpp` as the package name and lists only `dist/` files.
