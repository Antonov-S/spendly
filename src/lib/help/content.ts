import {
  Rocket,
  MessageCircleQuestion,
  Wallet,
  ArrowLeftRight,
  Gauge,
  RefreshCw,
  Target,
  BarChart3,
  Shapes,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * In-app Help / FAQ content. A typed, static data module (no DB, no I/O) — the
 * `/help` page is a dumb renderer over this array, mirroring how the landing
 * copy lives in `src/lib/marketing/*`. Every behavioural claim describes the
 * *real, shipped* app (principle #6, "never UI without backing function");
 * keep it reconciled with `docs/project-overview.md` when behaviour changes
 * (see the maintenance contract in `docs/features/help-faq-route-spec.md` §13).
 */

export interface HelpItem {
  /** Bolded lead-in, e.g. "Derived balance". Omit for a plain paragraph. */
  term?: string;
  /** The explainer body. Keep to 1–2 sentences. */
  detail: string;
}

export interface HelpSection {
  /** Stable anchor id for the TOC + deep links (e.g. "accounts"). Unique. */
  id: string;
  /** Card heading, sentence case (e.g. "Accounts"). */
  title: string;
  /** Lucide icon for the section's tinted icon square. */
  icon: LucideIcon;
  /** Hex accent for the icon square (tinted bg + colored glyph). */
  color: string;
  /** One-line orientation under the heading. */
  intro?: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: Rocket,
    color: "#1D9E75",
    intro:
      "Spendly is fast manual tracking — you capture each transaction in a few seconds, with awareness.",
    items: [
      {
        detail:
          "Create at least one account with a starting balance, then add transactions to it. Everything else builds on that ledger.",
      },
      {
        term: "The account selector",
        detail:
          "in the topbar is a global filter — it scopes the whole app to one account when active, and shows an indicator when you're not viewing everything.",
      },
      {
        term: "Five-second capture",
        detail:
          "Use the Add button (or the + on mobile) to open the transaction drawer. Re-entering an expense in a familiar category is meant to take seconds, not minutes.",
      },
    ],
  },
  {
    // Framed by point-of-confusion, not entity — the user who doesn't yet know
    // which entity their question maps to lands here first.
    id: "common-questions",
    title: "Common questions",
    icon: MessageCircleQuestion,
    color: "#378ADD",
    items: [
      {
        term: "Why doesn't my balance match my bank?",
        detail:
          "Balances are derived from the transactions you've entered — Spendly never syncs with your bank. Add the missing transactions and it reconciles.",
      },
      {
        term: "Where did my deleted transaction go?",
        detail:
          "Deletes are soft, with an 8-second snackbar undo. After that the transaction moves to Recently deleted — restore it or remove it for good there whenever you like.",
      },
      {
        term: "Why is my recurring expense not in the ledger?",
        detail:
          "Recurring templates create drafts you confirm — they never post silently. Confirm the draft on the Recurring page and it becomes a real transaction.",
      },
      {
        term: "Why can't I see older Reports?",
        detail:
          "Free shows the last 3 months; Pro unlocks the last 12. Upgrade under Settings → Billing.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    icon: Wallet,
    color: "#7F77DD",
    intro: "Accounts hold your transaction history. Manage them on the Accounts page.",
    items: [
      {
        term: "Derived balance",
        detail:
          "An account's balance is its starting balance plus the sum of its transactions — it's never edited directly.",
      },
      {
        term: "Liability accounts",
        detail:
          "Credit cards can open negative: the starting balance is signed, so a card can start below zero.",
      },
      {
        term: "Archiving",
        detail:
          "Archived accounts drop out of the selectors and totals but keep their full history, and they can't receive new transactions.",
      },
    ],
  },
  {
    id: "transactions",
    title: "Transactions",
    icon: ArrowLeftRight,
    color: "#D85A30",
    items: [
      {
        term: "Three types",
        detail:
          "Income, expense, and transfer. A transfer is one logical move shown as a single row spanning two accounts.",
      },
      {
        term: "You enter a positive amount",
        detail:
          "Pick the type and enter the amount — Spendly handles the sign. Expenses subtract, income adds.",
      },
      {
        term: "Undo",
        detail:
          "Deleting is a soft delete with an 8-second snackbar undo. After that, deleted transactions wait in Recently deleted, where you can restore them or delete them permanently.",
      },
    ],
  },
  {
    id: "budgets",
    title: "Budgets",
    icon: Gauge,
    color: "#EF9F27",
    items: [
      {
        term: "Monthly ceilings",
        detail:
          "One budget per category per month, with green / amber / red progress as you spend.",
      },
      {
        term: "Roll over remainder",
        detail:
          "Off by default — each budget resets clean every month. Turn on “Roll over remainder” for a budget and its leftover (or overspend) carries into next month: a €400 budget with €320 spent starts next month at €480, while overspending shrinks it. The carry only flows while the budget stays on in consecutive months.",
      },
    ],
  },
  {
    id: "recurring",
    title: "Recurring",
    icon: RefreshCw,
    color: "#378ADD",
    items: [
      {
        term: "Drafts you confirm",
        detail:
          "Recurring templates generate drafts for you to confirm — never silent ledger entries. That keeps the conscious-capture moment without the repetitive typing.",
      },
      {
        term: "Pause and resume",
        detail:
          "Templates can be paused and resumed, and confirmed drafts carry the template's name onto the transaction.",
      },
    ],
  },
  {
    id: "goals",
    title: "Goals",
    icon: Target,
    color: "#1D9E75",
    items: [
      {
        term: "Virtual progress",
        detail:
          "Goals track savings progress only — they don't touch your account balances or budgets.",
      },
      {
        term: "Contributions",
        detail:
          'Add contributions (or negative withdrawals); a goal can be overfunded, in which case it shows "Over 100%".',
      },
      {
        term: "Completion is manual",
        detail:
          "Reaching the target doesn't auto-complete a goal — you mark it complete yourself.",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    icon: BarChart3,
    color: "#F97316",
    items: [
      {
        detail:
          "Reports are analysis over time; the Dashboard is your current state — they're deliberately separate screens. Free shows the last 3 months, Pro the last 12.",
      },
    ],
  },
  {
    id: "categories",
    title: "Categories",
    icon: Shapes,
    color: "#D4537E",
    items: [
      {
        detail:
          "Spendly ships with 20 system categories, and you can add your own. Deleting one of your custom categories sends its transactions to Uncategorized.",
      },
    ],
  },
  {
    id: "data-privacy",
    title: "Data & privacy",
    icon: ShieldCheck,
    color: "#888780",
    items: [
      {
        term: "Export is free",
        detail:
          "Export everything to CSV or JSON on any plan, from Settings → Data & privacy.",
      },
      {
        term: "Importing your data",
        detail:
          "Bring history in from a CSV or a Spendly JSON export at Settings → Data & privacy → Import data. You map the file's columns, pick a target account, then review a preview before anything is saved. Re-importing the same file won't create duplicates.",
      },
      {
        term: "Deletion",
        detail:
          "Account deletion has a 30-day grace period, and you're prompted to export your data first.",
      },
      {
        term: "Currency",
        detail: "Spendly is EUR-only today.",
      },
    ],
  },
];
