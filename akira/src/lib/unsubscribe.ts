/** Pure helpers for inbox cleanup: header parsing, List-Unsubscribe (RFC 2369 / RFC 8058), sender grouping. */

export interface HeaderMessage {
  uid: number;
  from: string;
  subject: string;
  date: string;
  listUnsubscribe: string;
  listUnsubscribePost: string;
}

export interface UnsubscribeTargets {
  https: string[];
  mailto: string[];
  /** RFC 8058: sender accepts `POST List-Unsubscribe=One-Click` to the https URI. */
  oneClick: boolean;
}

export interface SenderGroup {
  address: string;
  name: string;
  domain: string;
  uids: number[];
  count: number;
  lastDate: string;
  sampleSubject: string;
  targets: UnsubscribeTargets;
}

/** Parse a raw RFC 5322 header block (as returned by IMAP HEADER.FIELDS) into lowercase-keyed values. */
export function parseHeaderBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    out[key] = out[key] ? `${out[key]}, ${val}` : val;
  }
  return out;
}

/** `"Shop" <news@shop.com>` → { name: "Shop", address: "news@shop.com" }. */
export function parseFrom(from: string): { name: string; address: string } {
  const angle = from.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : from.match(/[^\s"<>,;]+@[^\s"<>,;]+/)?.[0] ?? from).trim().toLowerCase();
  const name = angle ? from.slice(0, angle.index).replace(/["']/g, "").trim() : "";
  return { name: name || address, address };
}

export function parseListUnsubscribe(value: string, post = ""): UnsubscribeTargets {
  const https: string[] = [];
  const mailto: string[] = [];
  for (const m of value.matchAll(/<([^>]+)>/g)) {
    const uri = m[1].trim();
    if (/^https:\/\//i.test(uri)) https.push(uri);
    else if (/^mailto:/i.test(uri)) mailto.push(uri);
  }
  return { https, mailto, oneClick: https.length > 0 && /List-Unsubscribe\s*=\s*One-Click/i.test(post) };
}

/** `mailto:u@x.com?subject=unsub&body=hi` → { to, subject, body }. */
export function parseMailto(uri: string): { to: string; subject: string; body: string } {
  const rest = uri.replace(/^mailto:/i, "");
  const q = rest.indexOf("?");
  const to = decodeURIComponent(q < 0 ? rest : rest.slice(0, q));
  const params = new URLSearchParams(q < 0 ? "" : rest.slice(q + 1));
  return { to, subject: params.get("subject") || "unsubscribe", body: params.get("body") || "unsubscribe" };
}

export function matchesKeepList(address: string, keep: string[]): boolean {
  const domain = address.split("@")[1] ?? "";
  return keep.some((k) => {
    const rule = k.trim().toLowerCase();
    if (!rule) return false;
    if (rule.includes("@")) return rule === address;
    return domain === rule || domain.endsWith(`.${rule}`);
  });
}

/** Group bulk mail (messages carrying List-Unsubscribe) by sender address. Newest headers win for targets. */
export function groupBulkSenders(msgs: HeaderMessage[], keep: string[] = []): SenderGroup[] {
  const groups = new Map<string, SenderGroup>();
  for (const m of msgs) {
    if (!m.listUnsubscribe) continue;
    const { name, address } = parseFrom(m.from);
    if (!address.includes("@") || matchesKeepList(address, keep)) continue;
    const targets = parseListUnsubscribe(m.listUnsubscribe, m.listUnsubscribePost);
    let g = groups.get(address);
    if (!g) {
      g = { address, name, domain: address.split("@")[1], uids: [], count: 0, lastDate: "", sampleSubject: "", targets };
      groups.set(address, g);
    }
    g.uids.push(m.uid);
    g.count++;
    const t = Date.parse(m.date) || 0;
    if (!g.lastDate || t >= (Date.parse(g.lastDate) || 0)) {
      g.lastDate = t ? new Date(t).toISOString() : g.lastDate;
      g.sampleSubject = m.subject.slice(0, 160);
      if (targets.https.length || targets.mailto.length) g.targets = targets;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
