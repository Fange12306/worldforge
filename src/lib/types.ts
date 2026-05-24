export type Entry = {
  id: string;
  type: import("./constants").EntryType;
  name: string;
  properties: Record<string, unknown>;
  relationships: Relationship[];
  constraints: Constraint[];
  tags: string[];
  timeline_summary?: TimelinePeriod[];
  body?: string;
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Relationship = {
  targetId: string;
  relation: string;
  properties?: Record<string, unknown>;
};

export type Constraint = {
  rule: string;
  severity: "hard" | "soft";
};

export type ChapterInfo = {
  id: string;                              // UUID — immutable identity
  order: number;
  title: string;
  status: string;
  summary: string;
  has_body: boolean;
  word_count: number;
  time_period: [number, number] | null;   // deprecated — use linked_events
  involved_entries: string[];              // derived from linked_events
  linked_events?: LinkedEventRef[];        // 🆕 Phase 5
};

export type LinkedEventRef = {
  event_id: string;
  timeline_id: string;
};

export type StoryOutline = {
  id: string;
  title: string;
  chapters: Chapter[];
};

export type Chapter = {
  id: string;
  title: string;
  scenes: Scene[];
  time_period?: [number, number];
  involved_entries?: string[];
};

export type Scene = {
  id: string;
  title: string;
  povCharacterId?: string;
  locationId?: string;
  timelinePosition?: string;
  status: "planned" | "drafting" | "done";
  content: string;
};

export type ConsistencyReport = {
  violations: ConsistencyViolation[];
};

export type ConsistencyViolation = {
  level: "hard" | "soft";
  rule: string;
  passage: string;
  suggestion: string;
};

// ── Phase 5: Timeline & Event ──

export type TimeUnit = {
  key: string;
  name: string;
  max: number | null;
  display_order: number;
  digits: number;
};

export type TimeFormat = {
  units: TimeUnit[];
};

export type Timeline = {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  world_id: string;
  time_format: TimeFormat;
  created_at: string;
  updated_at: string;
};

export type LinkedEntry = {
  entry_id: string;
  perspective_summary?: string;
};

export type LinkedChapter = {
  story_id: string;
  chapter_order: number;
};

export type RelationChange = {
  entry_a: string;
  entry_b: string;
  change_type: "add" | "update" | "delete";
  relation: string;
  description?: string;
};

export type WorldEvent = {  // "Event" conflicts with DOM Event — use WorldEvent
  id: string;
  name: string; // human-readable slug, unique within timeline (e.g. "着陆失败-黎明号")
  timeline_id: string;
  time_point: string;
  precision?: number;          // unit index in time_format.units; null = full precision
  summary: string;
  linked_entries: LinkedEntry[];
  linked_chapters: LinkedChapter[];
  relationship_changes: RelationChange[];
  belongs_to_stories: string[];
  created_at: string;
  updated_at: string;
};

// ── Phase 4: Timeline summary ──

export type TimelinePeriod = {
  period: [number | null, number | null];
  state?: string;
  location?: string;
  summary?: string;
  relationships?: { target: string; description: string }[];
};

// ── Phase 4: Unified relation graph ──

export type EntityTypeRef = "entry" | "outline" | "timeline" | "event";

export type EntityRef = {
  type: EntityTypeRef;
  id: string;
  name?: string; // resolved display name (may be absent for internal edges)
};

export type RelationEdge = {
  id: string;           // UUID — immutable identity
  from: EntityRef;
  to: EntityRef;
  description: string;
  active_period?: [number, number] | null;
};
