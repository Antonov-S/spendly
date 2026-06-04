import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  RefreshCw,
  Target,
  BarChart3,
  Home,
  List,
  MoreHorizontal,
} from "lucide-react";
import type { NavItem } from "@/lib/system-constants";

/** App-level UI data. Shared types/enums live in system-constants.ts. */

/** Primary sidebar navigation (Help is rendered separately, pinned to bottom). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Budgets", href: "/budgets", icon: Wallet, alert: true },
  { label: "Recurring", href: "/recurring", icon: RefreshCw },
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

/** Mobile bottom navigation: Home, Transactions, Budgets, More (+ floating add). */
export const MOBILE_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Transactions", href: "/transactions", icon: List },
  { label: "Budgets", href: "/budgets", icon: Wallet },
  { label: "More", href: "/settings", icon: MoreHorizontal },
];
