import { describe, expect, it } from "vitest";
import { isActivePath } from "@/components/app-shell/nav-link";

const menu = ["/dashboard", "/projects", "/projects/new", "/requests", "/requests/boq"];

describe("isActivePath", () => {
  it("marks only the closest entry: /projects/new is New project, not Projects as well", () => {
    expect(isActivePath("/projects/new", "/projects/new", menu)).toBe(true);
    expect(isActivePath("/projects/new", "/projects", menu)).toBe(false);
  });

  it("keeps a parent active on its own pages and on a detail page, and leaves exact-only entries alone", () => {
    expect(isActivePath("/projects", "/projects", menu)).toBe(true);
    expect(isActivePath("/projects/HIT-PROJ-001", "/projects", menu)).toBe(true);
    expect(isActivePath("/requests/boq", "/requests", menu)).toBe(false);
    expect(isActivePath("/requests/boq", "/requests/boq", menu)).toBe(true);
    expect(isActivePath("/dashboard/x", "/dashboard", menu)).toBe(false);
  });

  it("works without the other entries (the guide link)", () => {
    expect(isActivePath("/guide", "/guide")).toBe(true);
    expect(isActivePath("/guided", "/guide")).toBe(false);
  });
});
