---
description: Run every check and hand the current branch off for Gemini review (CLAUDE.md workflow step 4)
---

Hand off the current branch for review, following `CLAUDE.md` → Workflow step 4.

1. Confirm you're on a feature or fix branch, not `main`. If you're on `main`, stop and say so.
2. If `backend/app/schemas.py` changed on this branch (`git diff main --name-only`), make sure `frontend/src/generated/` is up to date. The PostToolUse hook normally does this; if in doubt, run the steps in `README.md` → "Changing the data model".
3. Run all checks and report each result. Fix any failure before going on:

   ```bash
   cd frontend && npm test && npm run typecheck && npm run lint && npm run format:check && npm run build
   cd backend && .venv/bin/pytest && .venv/bin/ruff check . && .venv/bin/ruff format --check .
   ```

4. For UI changes, check the result in the running app (Playwright MCP, against the **isolated** copy described in `CLAUDE.md` → "Checking the app"), or by rendering it. Never use the owner's own app on ports 5173/8000.
5. Set the feature (`FEATURES.md`) or known issue (`ISSUES.md`) to `In review`. Write the handoff: branch, what changed, how to check it in the app, what you checked and how, and known limits. Add a dated change-log line.
6. End your message with: **Ready for Gemini review: `<branch>`**

$ARGUMENTS
