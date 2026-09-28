import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the akira package (contains brain/, src/). */
export const AKIRA_ROOT = process.env.AKIRA_ROOT ?? path.resolve(here, "..");
export const BRAIN = path.join(AKIRA_ROOT, "brain");

export const PATHS = {
  soul: path.join(AKIRA_ROOT, "SOUL.md"),
  identity: path.join(BRAIN, "identity.json"),
  memory: path.join(BRAIN, "memory", "MEMORY.md"),
  people: path.join(BRAIN, "memory", "people"),
  projects: path.join(BRAIN, "memory", "projects"),
  journal: path.join(BRAIN, "memory", "journal"),
  inbox: path.join(BRAIN, "memory", "inbox"),
  raw: path.join(BRAIN, "memory", "raw"),
  state: path.join(BRAIN, "state"),
  drafts: path.join(BRAIN, "state", "drafts"),
  documents: path.join(BRAIN, "documents"),
  documentsIncoming: path.join(BRAIN, "documents", "incoming"),
  manifest: path.join(BRAIN, "documents", "MANIFEST.jsonl"),
} as const;

/** Model used for Akira's reasoning. Override with AKIRA_MODEL. */
export const MODEL = process.env.AKIRA_MODEL ?? "claude-opus-5";

export const ENV = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  ntfyTopic: process.env.AKIRA_NTFY_TOPIC,
  resendApiKey: process.env.RESEND_API_KEY,
  notifyEmailTo: process.env.AKIRA_NOTIFY_EMAIL_TO,
  dryRun: process.env.AKIRA_DRY_RUN === "1",
};
