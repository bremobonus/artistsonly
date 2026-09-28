// Cloudflare Email Worker: akira@artistsonly.io → Akira's inbox.
// Setup: Cloudflare → artistsonly.io → Email → Email Routing → enable; create route akira@ → Send to a Worker (this one).
// Secrets on the worker: AKIRA_INGEST_SECRET. Optional var AKIRA_URL (default https://artistsonly.io).
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    const res = await fetch(`${env.AKIRA_URL ?? "https://artistsonly.io"}/api/akira/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.AKIRA_INGEST_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, envelopeFrom: message.from, envelopeTo: message.to }),
    });
    if (!res.ok) {
      // Never lose mail: bounce so the sender retries, and Cloudflare logs it.
      message.setReject(`Akira temporarily unavailable (${res.status})`);
    }
    if (env.FORWARD_TO) await message.forward(env.FORWARD_TO); // optional copy to Amos's own inbox
  },
};
