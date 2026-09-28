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

/** Email from akira@artistsonly.io via Resend. Only used for notifications to Amos, never for drafts. */
export async function email(subject: string, text: string): Promise<boolean> {
  const to = ENV.notifyEmailTo || identity().notify?.emailTo;
  if (!to || !ENV.resendApiKey || ENV.dryRun) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Akira <${identity().assistant.email}>`, to: [to], subject, text }),
    });
    return res.ok;
  } catch (e) {
    console.warn("[akira:notify] email failed", e);
    return false;
  }
}
