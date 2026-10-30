import { fieldLabel } from "@/domain/projects/fields";
import { formatDay } from "@/features/dashboards/format";
import type { ProjectChangeRow } from "@/server/projects/queries";

function Value({ value }: { value: string | null }) {
  return value === null ? <span className="text-muted-foreground italic">empty</span> : <span className="whitespace-pre-wrap">{value}</span>;
}

/** Who changed which field, from what to what, newest first, by day. */
export function ChangeLog({ changes }: { changes: ProjectChangeRow[] }) {
  if (changes.length === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No changes logged yet.
      </p>
    );
  }
  return (
    <ol aria-label="Change log" className="flex flex-col divide-y rounded-lg border">
      {changes.map((change) => (
        <li key={change.id} className="flex flex-col gap-1 p-3 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{change.changedByName}</span>
            <span className="text-muted-foreground">changed</span>
            <span className="font-medium">{fieldLabel(change.field)}</span>
            <time dateTime={change.changedAt.toISOString()} className="text-xs text-muted-foreground">
              {formatDay(change.changedAt)}
            </time>
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              <span className="mr-1 text-xs text-muted-foreground">From</span>
              <Value value={change.fromValue} />
            </p>
            <p>
              <span className="mr-1 text-xs text-muted-foreground">To</span>
              <Value value={change.toValue} />
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
