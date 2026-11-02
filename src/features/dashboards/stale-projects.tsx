import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PROJECTS_PATH } from "@/features/navigation/links";
import type { ProjectRow } from "@/server/requests/queries";
import { formatDay } from "./format";

/** The open projects nobody has touched for the longest time, oldest first: what needs a follow-up. */
export function StaleProjects({ projects }: { projects: ProjectRow[] }) {
  return (
    <section aria-label="Project paling lama tidak diperbarui" className="mb-6">
      <ChartCard title="5 project paling lama tidak diperbarui" description="Hanya project yang masih open. Tanggal terakhir ada perubahan, aksi, atau request pada project.">
        {projects.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Belum ada open project.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>End user</TableHead>
                <TableHead className="text-right">Last update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="max-w-64 truncate">
                    <Link href={`${PROJECTS_PATH}/${project.code}`} className="text-primary underline-offset-4 hover:underline">
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{project.endUserCompany}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatDay(project.lastUpdated)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ChartCard>
    </section>
  );
}
