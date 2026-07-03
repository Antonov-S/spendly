/**
 * In-app notification types (POST-MVP §9). Rung 1 of the escalation ladder —
 * derive-first, no persistence. These describe the DERIVED, per-entity items the
 * topbar bell renders; nothing here is stored (no `Notification` model). See
 * `docs/features/in-app-notifications-spec.md`.
 */

export type NotificationKind =
  | "budget-over"
  | "budget-risk"
  | "draft"
  | "goal-overdue";

/** Panel tones. Superset of `InsightItem`'s — `danger` exists only here (§3). */
export type NotificationTone = "danger" | "warning" | "info";

/** One derived, per-entity row in the notification panel. */
export interface NotificationItem {
  /**
   * Stable within one derivation, e.g. `budget-risk:<budgetId>`. NOT persisted
   * and meaningless beyond one payload — the same entity can change id between
   * derivations (a budget crossing 100% migrates `budget-risk:<id>` →
   * `budget-over:<id>`), and overflow rows reuse their group's kind with a
   * `:more` suffix. Exists for React keys + click telemetry only; never use it
   * as a cross-request identity, dedup key, or "seen" key (that would be rung-2
   * persistence through the back door — §0/§6).
   */
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  /** Primary copy, e.g. "Groceries budget at 92%". */
  label: string;
  /** Optional secondary line, e.g. a draft's suggested date ("Jun 28"). */
  detail?: string;
  /**
   * True only for the synthetic "+N more →" row a capped kind emits (§8.2).
   * Consumers branch on this flag — never on id naming conventions.
   */
  isOverflowRow?: boolean;
  href: string;
}

/** What `deriveNotifications` returns (and the action forwards to the bell). */
export interface NotificationsPayload {
  items: NotificationItem[];
  /**
   * Pre-cap actionable-entity counts per kind. Lightweight metadata alongside
   * the rendered items — telemetry and future UI variations read this without
   * re-deriving or reparsing `items`. Overflow rows are never counted here.
   */
  counts: Record<NotificationKind, number>;
  /**
   * Total actionable entities BEFORE per-kind caps — drives the badge.
   * Invariant (tested): equals the sum of `counts` values.
   */
  totalCount: number;
}
