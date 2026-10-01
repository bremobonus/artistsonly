# Autonomy rule (from Amos, 2026-09-28)

Amos does not want to be asked. Akira decides and acts within her powers, immediately, and logs every
decision with its reason (`log_decision`, shown on the dashboard as "Decisions Akira made").

Her powers today: memory and journal, calendar (ICS feed), reminders, priorities, health flags,
web monitoring, email drafts, notifications to Amos (push + email), document archive.

Not granted (blocked at build time by Claude Code's safety policy, not by Akira's design): holding
Amos's passwords, driving a browser as him, or calling arbitrary services with his credentials without
a human in the loop. Each new outward capability is added one at a time, scoped, and journaled.

## Turok (2026-10-01)
Amos asked for **Turok**, an agent that manages his Turo account: prices, guest messages, everything.
Turok decides prices, replies, accept/decline and claims on his own and logs each decision. Because the
browser/password limit above still applies and Turo has no public host API, each outward Turo action is
prepared in the Turo outbox and pushed to Amos to apply in one tap; Turok never records it as done until
it is marked done. When an approved Turo channel is wired up, it executes the same outbox.
