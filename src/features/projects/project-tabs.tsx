"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Tab = { id: string; label: string; content: React.ReactNode };

/**
 * Tabs for the long sections of a project page. Every panel stays in the page (hidden, not removed), so a half-filled form keeps its text
 * when another tab is opened. A tab changes only on a click or an arrow key. An address that points into a panel (`#commercial`,
 * `#request-CODE`) opens that panel and scrolls to the target; the page itself opens on `defaultTab`.
 */
export function ProjectTabs({ tabs, defaultTab }: { tabs: Tab[]; defaultTab: string }) {
  const [active, setActive] = useState(defaultTab);

  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const panel = id ? document.getElementById(id)?.closest<HTMLElement>("[data-tab-panel]") : null;
      if (!panel) return;
      setActive(panel.dataset["tabPanel"] ?? defaultTab);
      // The panel is shown after this render, so the scroll waits for it.
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [defaultTab]);

  const move = (from: number, step: number) => {
    const next = tabs[(from + step + tabs.length) % tabs.length];
    if (!next) return;
    setActive(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div className="mb-6">
      <div role="tablist" aria-label="Detail project" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(index, 1);
              else if (event.key === "ArrowLeft") move(index, -1);
              else return;
              event.preventDefault();
            }}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap",
              active === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} data-tab-panel={tab.id} hidden={active !== tab.id}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
