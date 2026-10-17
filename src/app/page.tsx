import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/config/app";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-muted-foreground">
          The development environment is running. Business features are not built yet.
        </p>
      </div>
      <div>
        {/* Navigation keeps link semantics; buttonVariants only provides the styling. */}
        <a href="/api/health" className={buttonVariants({ variant: "outline" })}>
          Check system health
        </a>
      </div>
    </main>
  );
}
