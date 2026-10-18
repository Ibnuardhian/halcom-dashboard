import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listCustomers } from "@/server/customers/queries";

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: Pick<PageProps<"/customers">, "searchParams">) {
  const viewer = await requirePermission("customers.view");
  const query = await searchParams;
  const search = (typeof query.q === "string" ? query.q : "").slice(0, 100);
  const customers = await listCustomers(getDb(), viewer, search);

  return (
    <>
      <DashboardHeader
        title="Customers"
        summary="The end-user companies of your projects. A customer is added automatically when a project is created with a new end-user company; the same name is one customer."
      />
      <form role="search" className="mb-4 flex gap-2">
        <Input name="q" defaultValue={search} placeholder="Search customers" aria-label="Search customers" maxLength={100} className="max-w-md" />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Search
        </button>
        <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
          New project
        </Link>
      </form>
      {customers.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {search ? "No customer matches." : "No customer yet. Create a project and its end-user company appears here."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="hidden md:table-cell">Latest project</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <Link href={`${PROJECTS_PATH}?q=${encodeURIComponent(customer.name)}`} className="text-primary underline-offset-4 hover:underline">
                    {customer.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{customer.projects}</TableCell>
                <TableCell className="text-right tabular-nums">{customer.openProjects}</TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">{customer.lastProjectAt ? formatUtc(customer.lastProjectAt) : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
