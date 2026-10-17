# Hofstee matter: legal record (kept outside Akira)

Amos's rule (2026-10-04): **don't use Akira for this.** Nothing about this case goes in `akira/brain/`, and no Akira cycle reads or writes it.

| file | what |
|---|---|
| `CASE.md` | facts as reported, Amos's role, open questions, link to the working page |
| `originals/` | originals exactly as received. Never edit. |
| `MANIFEST.jsonl` | one SHA-256 line per original. Append-only. |
| `LOG.jsonl` | dated, neutral, sourced entries. Append-only. |

Verify an original: `sha256sum originals/<file>` should match its `MANIFEST.jsonl` line.
