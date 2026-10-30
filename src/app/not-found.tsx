import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Shown for any address that matches no page, signed in or not. `/` sends the person to their own dashboard or the sign-in page. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-heading text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted-foreground">Alamat ini tidak ada, atau halamannya sudah dipindahkan. Periksa alamatnya, atau kembali ke dashboard Anda.</p>
      <Link href="/" className={buttonVariants()}>
        Kembali ke dashboard
      </Link>
    </main>
  );
}
