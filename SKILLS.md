# Skills and Tooling

Recommendations are written by the reviewer (Gemini), the owner decides on them, and the developer (Claude) installs the ones that are accepted. Status values: `Proposed` · `Accepted` · `Installed` · `Rejected` · `Dropped`.

## Recommendations

| # | For | Skill / tool | What it does | Why now (feature / issue) | How to install | Status |
|---|---|---|---|---|---|---|
| 1 | Claude | Playwright MCP server (`@playwright/mcp`) | Lets Claude Code drive a live browser, click palette items, resize the room, run filler fixes, and inspect SVG/DOM and toast state directly. | Reproducing and verifying UI bugs **#13** (full-wall placement feedback), **#14** (room shrink clamping/warning), and **#15** (filler height and stray countertop sliver next to a fridge/tower), plus visual checks for **#5 phase C** elements. | `claude mcp add playwright npx @playwright/mcp@latest` ([github.com/microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)) | Proposed |
| 2 | Claude | `PostToolUse` schema/test hook + `/handoff` command (`.claude/settings.json`, `.claude/commands/handoff.md`) | Runs `npm run gen:api` when `backend/app/schemas.py` is edited and runs `vitest run`, `tsc -b`, and `pytest` before handoff to `In review`. | **#5 phase C** adds new element categories (`dishwasher`, `trash`, `hood`, `end_panel`), cooktop fuel type, and fridge hinge fields across backend and frontend schemas plus 6 rules (R1/R3/R8/R10/R12/R16/R19); prevents schema drift and regressions while fixing **#13–#15**. | Add hook in `.claude/settings.json` and `.claude/commands/handoff.md` ([Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks), [Slash Commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)) | Proposed |
| 3 | Gemini | Custom `/review` slash command (`.gemini/commands/review.toml`) | Defines a repeatable `/review` command that injects `git diff main...<branch>` and checks it against `PROJECT.md`, `FEATURES.md`, and `ISSUES.md`. | Initializes `.gemini/` in the repo so Gemini can review incoming branches for **UI bugs #13–#15** and **#5 phase C** in one command. | Create `.gemini/commands/review.toml` with a `prompt` using `!{git diff ...}` ([Gemini CLI Custom Commands](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/commands.md)) | Proposed |

## Installed

What's set up today, so the reviewer doesn't recommend it again.

| For | Name | Scope | Notes |
|---|---|---|---|
| Claude | Built-in `/code-review`, `/simplify`, `/security-review`, `/run` | Claude Code built-in | Available in every session |
| Claude | AWS skills (`aws-*`, `launch-with-aws`, …) | User-level (`~/.claude/skills`) | Not relevant unless the deployment moves to AWS |
| Gemini | (none in this repo yet) | | `.gemini/` doesn't exist yet |

## Change log

- 2026-11-06: File created.
- 2026-11-06: Added recommendations #1–#3 for UI bugs #13–#15 and feature #5 phase C.
