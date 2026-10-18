"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Asks the server now and then to renew the session while the page is open and visible, so working people are not signed out
 * mid-task, and sends the person to the sign-in page as soon as the session is gone (expired or revoked, for example after
 * signing out in another tab). It holds no credentials; the browser sends the HttpOnly cookie by itself.
 */
export function SessionKeepAlive() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/session/renew", { method: "POST", cache: "no-store", credentials: "same-origin" });
        if (response.status === 401 && !stopped) router.replace("/login");
      } catch {
        // Offline or a server restart: try again at the next tick; the next page load checks the session anyway.
      }
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);
  return null;
}
