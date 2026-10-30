import { Badge } from "@/components/ui/badge";
import { ACTION_KIND_LABELS, LATEST_CURRENT_COUNT, summariseActions } from "@/domain/projects/actions";
import { formatDay } from "@/features/dashboards/format";
import type { ProjectActionRow } from "@/server/projects/queries";
import { cn } from "@/lib/utils";

function Entry({ entry, showKind = true }: { entry: ProjectActionRow; showKind?: boolean }) {
  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {showKind ? (
          <Badge variant={entry.kind === "NEXT" ? "default" : "secondary"}>{ACTION_KIND_LABELS[entry.kind]}</Badge>
        ) : null}
        <span className="font-medium">{entry.authorName ?? "Imported"}</span>
        <time dateTime={entry.createdAt.toISOString()} className="text-xs text-muted-foreground">
          {formatDay(entry.createdAt)}
        </time>
      </p>
      <p className="whitespace-pre-wrap">{entry.body}</p>
    </li>
  );
}

function Panel({ title, hint, children, className }: { title: string; hint: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

/**
 * The project's feed, written like comments. At the top: the last two current actions (what was done) and the
 * latest next action (what follows). Below: every entry, newest first, with who added it and on which day.
 */
export function ActionFeed({ entries }: { entries: ProjectActionRow[] }) {
  const { current, next } = summariseActions(entries);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={`Current action (last ${LATEST_CURRENT_COUNT})`} hint="Apa yang sudah dikerjakan, terbaru di atas.">
          {current.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada yang dicatat.</p>
          ) : (
            <ol aria-label="Latest current actions" className="flex flex-col divide-y rounded-lg border">
              {current.map((entry) => (
                <Entry key={entry.id} entry={entry} showKind={false} />
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Next action" hint="Apa yang akan dikerjakan setelah current action.">
          {next ? (
            <ol aria-label="Latest next action" className="flex flex-col rounded-lg border border-primary/40 bg-accent/40">
              <Entry entry={next} showKind={false} />
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada yang dicatat.</p>
          )}
        </Panel>
      </div>
      <Panel title="All updates" hint="Terbaru di atas. Entri tidak bisa diubah; koreksi menjadi entri baru.">
        {entries.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No updates yet.
          </p>
        ) : (
          <ol aria-label="Update feed" className="flex flex-col divide-y rounded-lg border">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
