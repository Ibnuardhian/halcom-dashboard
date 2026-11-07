import type { NotificationSeverity } from "@/domain/notifications/severity";

/**
 * How a level looks wherever it is shown (the notification page, the Management dashboard): Info the normal blue, Warning amber, Danger
 * red. The level is always written in words next to the colour.
 */
export const SEVERITY_CARD_CLASS: Record<NotificationSeverity, { unread: string; read: string }> = {
  INFO: { unread: "border-primary/50 bg-accent/40", read: "" },
  WARNING: { unread: "border-warning bg-warning/15", read: "border-warning/40" },
  DANGER: { unread: "border-destructive bg-destructive/10", read: "border-destructive/40" },
};

export const SEVERITY_LABEL_CLASS: Record<NotificationSeverity, string> = {
  INFO: "bg-primary text-primary-foreground",
  WARNING: "bg-warning text-warning-foreground",
  DANGER: "bg-destructive text-white",
};

export const SEVERITY_LINK_CLASS: Record<NotificationSeverity, string> = { INFO: "text-primary", WARNING: "text-foreground", DANGER: "text-destructive" };
