import { ENV } from "../config.js";
import { identity } from "../lib/brain.js";

/** Push via ntfy.sh (free, no account: subscribe to the topic in the ntfy app). */
export async function push(title: string, body: string, priority: 1 | 2 | 3 | 4 | 5 = 3): Promise<boolean> {
  const topic = ENV.ntfyTopic || identity().notify?.ntfyTopic;
  if (!topic || ENV.dryRun) return false;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title, Priority: String(priority), Tags: "robot" },
      body,
    });
    return res.ok;
  } catch (e) {
    console.warn("[akira:notify] push failed", e);
    return false;
  }
}

export function emailConfigured(): boolean {
  return !!ENV.resendApiKey && !ENV.dryRun;
}

/** Send an email from akira@artistsonly.io via Resend. Returns the provider message id, or null. */
export async function sendMail(opts: { to: string[]; subject: string; text: string; replyTo?: string }): Promise<string | null> {
  if (!emailConfigured()) return null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Akira <${identity().assistant.email}>`, to: opts.to, subject: opts.subject, text: opts.text, reply_to: opts.replyTo }),
    });
    if (!res.ok) {
      console.warn("[akira:notify] send failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const j = (await res.json()) as { id?: string };
    return j.id ?? "sent";
  } catch (e) {
    console.warn("[akira:notify] send failed", e);
    return null;
  }
}

/** Notification email to Amos. */
export async function email(subject: string, text: string): Promise<boolean> {
  const to = ENV.notifyEmailTo || identity().notify?.emailTo;
  if (!to) return false;
  return (await sendMail({ to: [to], subject, text })) !== null;
}
