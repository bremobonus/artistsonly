# Document archive (legal-defence posture)

Every document that reaches Akira (email attachments, files dropped in `~/Akira/inbox` on a
computer, screenshots, PDFs, exports from other AI agents) is stored here and logged.

- `incoming/` — files as received, named `<received-ISO>__<sha256-prefix>__<original-name>`.
- `MANIFEST.jsonl` — one line per file: sha256, bytes, original name, source device/channel,
  received timestamp, handler, notes. Append-only.
- Akira writes a one-paragraph neutral summary of each document into the journal with the
  manifest id, so the timeline and the file are linked.

Chain of custody: the git commit that adds a file is signed by the workflow or by Amos's device.
Compare `sha256sum <file>` against the manifest line to prove the file is unchanged.
