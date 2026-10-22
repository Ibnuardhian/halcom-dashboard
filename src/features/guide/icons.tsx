import { ArrowRightLeft, BookOpen, Briefcase, Calculator, Eye, GitBranch, Play, Ruler, Settings, ShieldCheck, ShoppingCart, UserCog, type LucideIcon } from "lucide-react";
import type { Role } from "@/domain/access/roles";
import type { NodeKind } from "@/domain/guide/workflow";

/** One icon per role and per node kind, so responsibility and kind are always readable without colour. */
export const ROLE_ICONS: Record<Role, LucideIcon> = {
  SALES: Briefcase,
  SOA: Ruler,
  PURCHASING: ShoppingCart,
  FINANCE: Calculator,
  MANAGEMENT: Eye,
  ADMIN: UserCog,
  SUPERADMIN: ShieldCheck,
};

export const KIND_ICONS: Record<NodeKind, LucideIcon> = {
  action: Play,
  handoff: ArrowRightLeft,
  decision: GitBranch,
  readonly: BookOpen,
  setup: Settings,
};
