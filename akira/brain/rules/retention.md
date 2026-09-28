# Retention rule: never forget

1. `brain/memory/journal/*.jsonl` is append-only. Lines are never edited or removed.
2. `brain/memory/raw/**` holds every raw event exactly as it arrived. Never edited.
3. `brain/documents/MANIFEST.jsonl` is append-only. Each line records a document's SHA-256,
   size, source, received time and who handled it. A document is never removed from the archive.
4. `brain/memory/MEMORY.md` is curated long-term memory. It may be rewritten for clarity, but
   every fact removed from it must already exist in the journal, and the rewrite is itself journaled.
5. Git history is part of the record. Never force-push, rebase or squash the `main` branch.
6. Backups: the repo is the primary store; artistsonly.io reads from it. A second remote may be
   added as a mirror. Nothing is ever "cleaned up".
