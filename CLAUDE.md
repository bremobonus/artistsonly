# artistsonly.io + Akira — instructions for Claude sessions

This repo is Amos's memory. Akira (`akira/`) is his always-on AI chief of staff; the site (`site/`)
is artistsonly.io with the hidden operations room at `/akira`. Read `README.md` for the map and
`akira/SOUL.md` for who Akira is.

## Standing rules (from Amos)
- **Store everything. Never forget.** `akira/brain/memory/journal/*.jsonl`, `memory/raw/**` and
  `documents/MANIFEST.jsonl` are append-only. Never delete, edit or squash them. Never rewrite `main`.
- **Compile for legal defence.** Anything received (documents, emails, conversations) is archived with
  a SHA-256 manifest line and a neutral, dated, sourced journal entry. Preserve originals.
- **Create a brain / an agent where needed.** New capabilities go in `akira/src/cycles/` and tools in
  `akira/src/tools.ts`; every tool writes to the journal.
- **Show work as an interactive HTML page.** Every report, status update or set of decisions for Amos is
  published as an HTML5 artifact he can interact with and respond on (Artifact tool), not only as chat text.
  His responses on the page are read back and journaled.
- **Always show the link.** Every reply that produces or changes something ends with its links: the live URL
  (e.g. `https://artistsonly.io/flock`), the published artifact URL, and the PR. Never make Amos ask for one.
- Akira never asks Amos; she decides within her powers and logs it (`akira/brain/rules/autonomy.md`). Drafts to third parties still go out only through channels Amos has wired up.

## Working here
- `npm test` in `akira/` (node:test), `npx tsc --noEmit` in both packages, `npm run build` in `site/`.
- Run a cycle: `cd akira && ANTHROPIC_API_KEY=… npx tsx src/index.ts heartbeat` (or `web-monitor`,
  `daily-brief`, `health-review`, `compact-memory`, `dashboard`). `AKIRA_DRY_RUN=1` disables push/email.
- Never run a model cycle against the real brain from a dev session unless asked; test on a copy with `AKIRA_ROOT=<tmp>`.
- Local site: `AKIRA_LOCAL_BRAIN=1 npm run dev` in `site/` reads `../akira/brain` from disk.
- Commits by the Akira workflow are prefixed `[akira]`; do not amend or rebase them.
- Use the `/akira` skill (`.claude/skills/akira/SKILL.md`) for operating procedures.
