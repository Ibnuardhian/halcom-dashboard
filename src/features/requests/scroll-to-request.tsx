"use client";

import { useEffect } from "react";

/**
 * Brings one request of the project page into view when the page was opened for it (`?request=CODE`, which is where the old
 * request address leads). A redirect does not always carry the `#request-CODE` anchor through a client-side navigation, so the
 * scroll is done here. It does nothing when the request is not on the page.
 */
export function ScrollToRequest({ code }: { code: string }) {
  useEffect(() => {
    document.getElementById(`request-${code}`)?.scrollIntoView({ block: "start" });
  }, [code]);
  return null;
}
