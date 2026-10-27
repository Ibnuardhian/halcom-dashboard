import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/domain/access/permissions";
import { FILTER_EXTERNAL, FILTER_NONE, readDrillFilters } from "@/domain/projects/drilldown";
import { FUNNEL_STEPS } from "@/domain/projects/funnel";
import { PROGRESS_LABELS, PROJECT_PROGRESSES, TRACK_STATUSES, TRACK_STATUS_LABELS } from "@/domain/projects/progress";
import { PROJECT_SOURCE_TYPES, SOURCE_LABELS } from "@/domain/projects/source";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { formatDay } from "@/features/dashboards/format";
import { ImportDialog } from "@/features/projects/import-dialog";
import { ProgressBadge, TrackStatusBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import {
  DEFAULT_PROJECT_PAGE_SIZE,
  listPrincipalOptions,
  PROJECT_PAGE_SIZES,
  PROJECT_SHOW_LABELS,
  PROJECT_SHOWS,
  PROJECT_SORTS,
  searchProjects,
  type ProjectFilter,
  type ProjectPageSize,
  type ProjectSort,
} from "@/server/requests/queries";

export default function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Projects searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A sortable header: a link (never plain text), so the generic click-to-sort-the-visible-rows behaviour of `Table` never applies to
 * it — sorting a page of a server-paginated table that way would only reorder the rows shown, not the whole matching set. */
function SortableHead({ label, column, active, dir, href, className }: { label: string; column: ProjectSort; active: boolean; dir: "asc" | "desc"; href: (column: ProjectSort) => string; className?: string }) {
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={href(column)} className="inline-flex items-center gap-1 hover:underline">
        {label}
        {active ? <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span> : null}
      </Link>
    </TableHead>
  );
}

async function Projects({ searchParams }: Pick<PageProps<"/projects">, "searchParams">) {
  const viewer = await requirePermission("projects.view");
  const query = await searchParams;
  const search = one(query.q).slice(0, 100);
  const progress = PROJECT_PROGRESSES.find((p) => p === one(query.progress));
  const trackStatus = TRACK_STATUSES.find((s) => s === one(query.status));
  const principals = await listPrincipalOptions(getDb(), viewer);
  // The Overview charts link here with filters (D-031); the principal select shows a single principal, any others stay as hidden fields.
  const drill = readDrillFilters(query);
  const principalId = drill.principal?.length === 1 ? principals.find((p) => p.id === drill.principal![0])?.id : undefined;
  const otherPrincipals = principalId ? [] : (drill.principal ?? []);
  const show = PROJECT_SHOWS.find((s) => s === one(query.show));
  const sourceType = PROJECT_SOURCE_TYPES.find((s) => s === one(query.source));
  // "mine" is the salesperson's view of the tiles; it only ever narrows to the signed-in user's own projects.
  const mine = one(query.mine) === "1";
  const filter: ProjectFilter = {
    search,
    progress,
    trackStatus,
    principalId,
    show,
    sourceType,
    salesOwnerId: mine ? viewer.id : undefined,
    reached: drill.reached,
    principalKeys: otherPrincipals,
    solutionKeys: drill.solution,
    ownerKeys: drill.owner,
    industryKeys: drill.industry,
  };
  // Names for the chart filters, so the page says what it is showing.
  const [solutionNames, ownerNames] = await Promise.all([
    drill.solution?.some((key) => key !== FILTER_NONE) ? getDb().solutionCategory.findMany({ where: { id: { in: drill.solution.filter((key) => key !== FILTER_NONE) } }, select: { id: true, name: true } }) : [],
    drill.owner?.some((key) => key !== FILTER_NONE && key !== FILTER_EXTERNAL) ? getDb().user.findMany({ where: { id: { in: drill.owner.filter((key) => key !== FILTER_NONE && key !== FILTER_EXTERNAL) } }, select: { id: true, name: true } }) : [],
  ]);
  const describe = (keys: readonly string[] | undefined, names: readonly { id: string; name: string }[], noneLabel: string, extraLabel?: string) =>
    (keys ?? []).map((key) => (key === FILTER_NONE ? noneLabel : key === FILTER_EXTERNAL ? (extraLabel ?? noneLabel) : (names.find((n) => n.id === key)?.name ?? "unknown"))).join(", ");
  const chartFilters = [
    drill.reached ? `reached ${FUNNEL_STEPS.find((step) => step.key === drill.reached)?.label ?? drill.reached} or later` : null,
    otherPrincipals.length > 0 ? `principal: ${describe(otherPrincipals, principals, "Not set")}` : null,
    drill.solution?.length ? `solution: ${describe(drill.solution, solutionNames, "Not set")}` : null,
    drill.industry?.length ? `industry: ${drill.industry.map((key) => (key === FILTER_NONE ? "Not set" : key)).join(", ")}` : null,
    drill.owner?.length ? `Sales PIC: ${describe(drill.owner, ownerNames, "Not set", "Other (no internal Sales PIC)")}` : null,
  ].filter((text): text is string => text !== null);
  // Rows per page: 25, 50, 100 or all. Anything else falls back to the default; the page number is clamped by the query.
  const wantedSize = one(query.per);
  const pageSize: ProjectPageSize = wantedSize === "all" ? "all" : (PROJECT_PAGE_SIZES.find((size) => String(size) === wantedSize) ?? DEFAULT_PROJECT_PAGE_SIZE);
  // The whole matching set is sorted before a page is cut out of it (`searchProjects`), so "Rows per page" never changes what a
  // column sort covers. With no column chosen, the project SOA updated last comes first (projects never updated follow, newest number first).
  const sort: ProjectSort = PROJECT_SORTS.find((s) => s === one(query.sort)) ?? "lastUpdate";
  const defaultDir = (column: ProjectSort): "asc" | "desc" => (column === "code" || column === "lastUpdate" ? "desc" : "asc");
  const dir: "asc" | "desc" = one(query.dir) === "asc" || one(query.dir) === "desc" ? (one(query.dir) as "asc" | "desc") : defaultDir(sort);
  const result = await searchProjects(getDb(), viewer, filter, { page: Number(one(query.page)) || 1, pageSize, sort, dir });
  const projects = result.rows;
  // Every link of the table keeps the filters, so paging and sorting never lose them.
  const href = (next: { page?: number; per?: ProjectPageSize; sort?: ProjectSort; dir?: "asc" | "desc" }) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (progress) params.set("progress", progress);
    if (trackStatus) params.set("status", trackStatus);
    if (principalId) params.set("principal", principalId);
    for (const key of otherPrincipals) params.append("principal", key);
    if (drill.reached) params.set("reached", drill.reached);
    for (const name of ["solution", "industry", "owner"] as const) for (const value of drill[name] ?? []) params.append(name, value);
    if (show) params.set("show", show);
    if (sourceType) params.set("source", sourceType);
    if (mine) params.set("mine", "1");
    const per = next.per ?? pageSize;
    if (per !== DEFAULT_PROJECT_PAGE_SIZE) params.set("per", String(per));
    const nextSort = next.sort ?? sort;
    const nextDir = next.dir ?? dir;
    if (nextSort !== "lastUpdate") params.set("sort", nextSort);
    if (nextDir !== defaultDir(nextSort)) params.set("dir", nextDir);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const text = params.toString();
    return text ? `${PROJECTS_PATH}?${text}` : PROJECTS_PATH;
  };
  const sortHref = (column: ProjectSort) => href({ sort: column, dir: column === sort ? (dir === "asc" ? "desc" : "asc") : defaultDir(column), page: 1 });
  const firstShown = projects.length === 0 ? 0 : pageSize === "all" ? 1 : (result.page - 1) * pageSize + 1;
  const filtered = Boolean(search || progress || trackStatus || principalId || show || sourceType || mine || chartFilters.length > 0);

  return (
    <>
      <DashboardHeader
        title="Projects"
        summary="Semua proyek dalam pipeline, terbaru di atas. Nilai berupa angka biasa (diasumsikan dalam Rupiah/IDR); weighted value dihitung dari estimated value dikali probability."
      />
      <div className="mb-4 flex flex-col gap-3">
        <form role="search" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
          {show ? <input type="hidden" name="show" value={show} /> : null}
          {mine ? <input type="hidden" name="mine" value="1" /> : null}
          {drill.reached ? <input type="hidden" name="reached" value={drill.reached} /> : null}
          {otherPrincipals.map((key) => <input key={`principal-${key}`} type="hidden" name="principal" value={key} />)}
          {(["solution", "industry", "owner"] as const).flatMap((name) => (drill[name] ?? []).map((value) => <input key={`${name}-${value}`} type="hidden" name={name} value={value} />))}
          {pageSize !== DEFAULT_PROJECT_PAGE_SIZE ? <input type="hidden" name="per" value={String(pageSize)} /> : null}
          <Input name="q" defaultValue={search} placeholder="Cari kode, customer, project, PIC, principal, atau external source" aria-label="Search projects" maxLength={100} />
          <NativeSelect name="progress" defaultValue={progress ?? ""} aria-label="Progress">
            <option value="">All progress</option>
            {PROJECT_PROGRESSES.map((p) => (
              <option key={p} value={p}>
                {PROGRESS_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="status" defaultValue={trackStatus ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {TRACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRACK_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="principal" defaultValue={principalId ?? ""} aria-label="Principal">
            <option value="">All principals</option>
            {principals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="source" defaultValue={sourceType ?? ""} aria-label="Project source">
            <option value="">All sources</option>
            {PROJECT_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Filter
          </button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted-foreground">
            {result.total} project{result.total === 1 ? "" : "s"}
            {show ? <> · {PROJECT_SHOW_LABELS[show]}{mine ? ", yours" : ""}</> : null}
            {chartFilters.length > 0 ? <> · {chartFilters.join(" · ")}</> : null}
            {filtered ? (
              <>
                {" "}
                match.{" "}
                <Link href={PROJECTS_PATH} className="underline underline-offset-4">
                  Clear filters
                </Link>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {can(viewer.role, "projects.import") ? <ImportDialog canUpdate={can(viewer.role, "projects.bulk-update")} /> : null}
            {can(viewer.role, "projects.create") || can(viewer.role, "projects.create.external") ? (
              <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
                New project
              </Link>
            ) : null}
          </div>
        </div>
      </div>
      {projects.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {filtered ? "Tidak ada project yang cocok dengan filter ini." : "Belum ada project."}
        </p>
      ) : (
        <Table topScroll>
          <TableHeader>
            <TableRow>
              <SortableHead label="Project ID" column="code" active={sort === "code"} dir={dir} href={sortHref} className="sticky left-0 z-10 bg-background" />
              <SortableHead label="End user" column="endUser" active={sort === "endUser"} dir={dir} href={sortHref} />
              <SortableHead label="Project" column="name" active={sort === "name"} dir={dir} href={sortHref} />
              <SortableHead label="Progress" column="progress" active={sort === "progress"} dir={dir} href={sortHref} />
              <SortableHead label="Status" column="status" active={sort === "status"} dir={dir} href={sortHref} className="hidden sm:table-cell" />
              <TableHead className="hidden lg:table-cell">Principals</TableHead>
              <SortableHead label="Sales PIC" column="salesOwner" active={sort === "salesOwner"} dir={dir} href={sortHref} className="hidden md:table-cell" />
              <SortableHead label="Technical PIC" column="technicalPic" active={sort === "technicalPic"} dir={dir} href={sortHref} className="hidden xl:table-cell" />
              <SortableHead label="Last updated" column="lastUpdate" active={sort === "lastUpdate"} dir={dir} href={sortHref} className="hidden lg:table-cell" />
              <TableHead className="hidden text-right md:table-cell">Open requests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="sticky left-0 z-10 bg-background font-mono text-xs font-medium whitespace-nowrap">
                  <Link href={`${PROJECTS_PATH}/${project.code}`} className="text-primary underline-offset-4 hover:underline">
                    {project.code}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate">{project.endUserCompany}</TableCell>
                <TableCell className="max-w-64 truncate">{project.name}</TableCell>
                <TableCell>
                  <ProgressBadge progress={project.progress} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <TrackStatusBadge status={project.trackStatus} />
                </TableCell>
                <TableCell className="hidden lg:table-cell">{project.principalName ?? "–"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {project.salesOwnerName}
                  {project.sourceType !== "INTERNAL_SALES" ? <span className="ml-1 text-xs text-muted-foreground">({SOURCE_LABELS[project.sourceType]})</span> : null}
                </TableCell>
                <TableCell className="hidden xl:table-cell">{project.technicalPicName ?? "–"}</TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDay(project.lastUpdated)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {project.openRequests} / {project.totalRequests}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {result.total > 0 ? (
        <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing {firstShown}–{firstShown + projects.length - 1} of {result.total}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Rows per page" className="flex items-center gap-1">
              <span className="text-muted-foreground">Rows per page</span>
              {([...PROJECT_PAGE_SIZES, "all"] as const).map((size) => (
                <Link
                  key={size}
                  href={href({ per: size, page: 1 })}
                  aria-current={pageSize === size ? "true" : undefined}
                  className={buttonVariants({ variant: pageSize === size ? "default" : "outline", size: "sm" })}
                >
                  {size === "all" ? "All" : size}
                </Link>
              ))}
            </div>
            {result.pageCount > 1 ? (
              <div className="flex items-center gap-2">
                {result.page > 1 ? (
                  <Link href={href({ page: result.page - 1 })} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Previous
                  </Link>
                ) : null}
                <span className="text-muted-foreground">
                  Page {result.page} of {result.pageCount}
                </span>
                {result.page < result.pageCount ? (
                  <Link href={href({ page: result.page + 1 })} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Next
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
