import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/domain/access/permissions";
import { PROGRESS_LABELS, PROJECT_PROGRESSES, TRACK_STATUSES, TRACK_STATUS_LABELS } from "@/domain/projects/progress";
import { PROJECT_SOURCE_TYPES, SOURCE_LABELS } from "@/domain/projects/source";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatPercent } from "@/features/projects/format";
import { formatDateOnly } from "@/features/requests/format";
import { ProgressBadge, TrackStatusBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listPrincipalOptions, listProjects, PROJECT_SHOW_LABELS, PROJECT_SHOWS, type ProjectFilter } from "@/server/requests/queries";

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

async function Projects({ searchParams }: Pick<PageProps<"/projects">, "searchParams">) {
  const viewer = await requirePermission("projects.view");
  const query = await searchParams;
  const search = one(query.q).slice(0, 100);
  const progress = PROJECT_PROGRESSES.find((p) => p === one(query.progress));
  const trackStatus = TRACK_STATUSES.find((s) => s === one(query.status));
  const principals = await listPrincipalOptions(getDb(), viewer);
  const principalId = principals.find((p) => p.id === one(query.principal))?.id;
  const show = PROJECT_SHOWS.find((s) => s === one(query.show));
  const sourceType = PROJECT_SOURCE_TYPES.find((s) => s === one(query.source));
  // "mine" is the salesperson's view of the tiles; it only ever narrows to the signed-in user's own projects.
  const mine = one(query.mine) === "1";
  const filter: ProjectFilter = { search, progress, trackStatus, principalId, show, sourceType, salesOwnerId: mine ? viewer.id : undefined };
  const projects = await listProjects(getDb(), viewer, filter);
  const filtered = Boolean(search || progress || trackStatus || principalId || show || sourceType || mine);

  return (
    <>
      <DashboardHeader
        title="Projects"
        summary="Every project in the pipeline, newest first. Values are plain numbers (assumed IDR); weighted value is estimated value times probability."
      />
      <div className="mb-4 flex flex-col gap-3">
        <form role="search" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
          {show ? <input type="hidden" name="show" value={show} /> : null}
          {mine ? <input type="hidden" name="mine" value="1" /> : null}
          <Input name="q" defaultValue={search} placeholder="Search code, customer, project, PIC, principal or external source" aria-label="Search projects" maxLength={100} />
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
            {projects.length} project{projects.length === 1 ? "" : "s"}
            {show ? <> · {PROJECT_SHOW_LABELS[show]}{mine ? ", yours" : ""}</> : null}
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
          {can(viewer.role, "projects.create") || can(viewer.role, "projects.create.external") ? (
            <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
              New project
            </Link>
          ) : null}
        </div>
      </div>
      {projects.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {filtered ? "No project matches these filters." : "No projects yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project ID</TableHead>
              <TableHead>End user</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Principal</TableHead>
              <TableHead className="hidden md:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell">Sales PIC</TableHead>
              <TableHead className="hidden xl:table-cell">Technical PIC</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Estimated</TableHead>
              <TableHead className="hidden text-right xl:table-cell">Prob.</TableHead>
              <TableHead className="hidden text-right xl:table-cell">Weighted</TableHead>
              <TableHead className="hidden lg:table-cell">Target closing</TableHead>
              <TableHead className="hidden text-right md:table-cell">Open requests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="font-mono text-xs font-medium whitespace-nowrap">
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
                <TableCell className="hidden md:table-cell">{SOURCE_LABELS[project.sourceType]}</TableCell>
                <TableCell className="hidden md:table-cell">{project.salesOwnerName}</TableCell>
                <TableCell className="hidden xl:table-cell">{project.technicalPicName ?? "–"}</TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatAmount(project.estimatedValue)}</TableCell>
                <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatPercent(project.probability)}</TableCell>
                <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatAmount(project.weightedValue)}</TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateOnly(project.targetDate)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {project.openRequests} / {project.totalRequests}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
