import Link from "next/link";

/** A headline number. With `href` the whole tile links to the list behind it. */
export function StatTile({ label, value, note, href }: { label: string; value: string | number; note?: string; href?: string }) {
  const body = (
    <div className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-primary sm:text-3xl">{value}</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
  const frame = "block rounded-xl ring-1 ring-foreground/10";
  return href ? (
    <Link href={href} className={`${frame} transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring`}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}
