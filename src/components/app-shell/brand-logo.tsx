import Image from "next/image";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

/**
 * The Halcom wordmark. It is blue ink on a transparent background, so in the dark theme it sits
 * on a white plate instead of being recoloured.
 */
export function BrandLogo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/halcom-logo.png"
      alt={APP_NAME}
      width={301}
      height={90}
      priority={priority}
      className={cn("h-9 w-auto dark:rounded-md dark:bg-white dark:px-2 dark:py-1", className)}
    />
  );
}
