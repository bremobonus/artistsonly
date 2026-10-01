/** Shared shapes for the brain. The site imports this file too (site/lib/akira-types.ts re-exports). */

export type IngestSource =
  | "apple_health"
  | "device"
  | "conversation"
  | "email"
  | "note"
  | "document"
  | "calendar"
  | "web"
  | "location"
  | "system";

export interface IngestEvent {
  id: string;
  ts: string;
  source: IngestSource;
  /** Device or channel id, e.g. "iphone", "mac-main", "claude-code", "chatgpt", "email". */
  device?: string;
  /** Free-form subtype, e.g. "heartbeat", "sleep", "workout", "session", "inbound". */
  type?: string;
  payload: unknown;
}

export interface JournalEntry {
  id: string;
  ts: string;
  kind: "event" | "fact" | "commitment" | "decision" | "mention" | "document" | "health" | "system" | "draft" | "question";
  source: string;
  summary: string;
  tags?: string[];
  refs?: string[];
  data?: unknown;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  source: string;
  createdAt: string;
  /** Google Calendar event id when the event was pushed to or pulled from Google. */
  googleId?: string;
}

export interface Reminder {
  id: string;
  text: string;
  due: string;
  priority: "low" | "normal" | "high" | "urgent";
  done: boolean;
  source: string;
  createdAt: string;
  notifiedAt?: string;
}

export interface PriorityItem {
  rank: number;
  text: string;
  why: string;
  status: "todo" | "doing" | "done" | "dropped";
}

export interface Priorities {
  date: string;
  items: PriorityItem[];
  notes: string;
  updatedAt: string;
}

export interface HealthDaily {
  date: string;
  steps?: number;
  restingHeartRate?: number;
  heartRateAvg?: number;
  hrv?: number;
  sleepHours?: number;
  activeEnergyKcal?: number;
  exerciseMinutes?: number;
  standHours?: number;
  bloodOxygen?: number;
  respiratoryRate?: number;
  weightKg?: number;
  workouts?: Array<{ type: string; minutes: number; start: string }>;
}

export interface HealthState {
  latest: Partial<HealthDaily> & { asOf?: string };
  daily: HealthDaily[];
  flags: Array<{ ts: string; level: "info" | "watch" | "concern"; text: string }>;
  updatedAt: string;
}

export interface DeviceInfo {
  id: string;
  label: string;
  kind: string;
  lastSeen?: string;
  battery?: number;
  summary?: string;
  extra?: Record<string, unknown>;
}

export interface DevicesState {
  devices: Record<string, DeviceInfo>;
  updatedAt: string;
}

export interface Mention {
  id: string;
  url: string;
  title: string;
  site: string;
  foundAt: string;
  publishedAt?: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  severity: "info" | "watch" | "act";
}

export interface MentionsState {
  items: Mention[];
  lastRunAt?: string;
  updatedAt: string;
}

export interface DraftMeta {
  id: string;
  to: string;
  subject: string;
  file: string;
  status: "draft" | "approved" | "sent" | "discarded";
  createdAt: string;
  why: string;
}

/** A decision Akira made on Amos's behalf (she decides and logs; she does not ask). */
export interface Question {
  id: string;
  text: string;
  context: string;
  askedAt: string;
  answered?: boolean;
}

export interface ActivityItem {
  ts: string;
  cycle: string;
  action: string;
  detail: string;
}

export interface Dashboard {
  generatedAt: string;
  assistant: { name: string; email: string; version: string; status: "online" | "degraded" };
  owner: { name: string; timezone: string };
  now: { lastCycle?: ActivityItem; nextCycles: Array<{ name: string; every: string }>; working: string[] };
  counts: {
    journalEntries: number;
    documents: number;
    calendarUpcoming: number;
    remindersOpen: number;
    mentions: number;
    drafts: number;
    questions: number;
  };
  calendar: CalendarEvent[];
  reminders: Reminder[];
  priorities: Priorities;
  health: HealthState;
  devices: DevicesState;
  mentions: MentionsState;
  drafts: DraftMeta[];
  questions: Question[];
  journalRecent: JournalEntry[];
  activity: ActivityItem[];
  memoryExcerpt: string;
}
