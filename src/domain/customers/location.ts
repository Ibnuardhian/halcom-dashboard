/**
 * A customer has no location of its own: the location is typed on each project. The customer's location is the one most of its
 * projects name (ties go to the one used most recently), so a customer is counted once, under one location.
 */

/** How locations are grouped: trimmed and lower-case, so "Jakarta", " jakarta " and "JAKARTA" are one. Null when nothing was typed. */
export function locationKey(location: string | null | undefined): string | null {
  const key = location?.trim().toLowerCase();
  return key ? key : null;
}

export type LocatedProject = { location: string | null; createdAt: Date };

/** The location to show and group a customer under, as typed on its most recent project of that place; null when no project has one. */
export function customerLocation(projects: readonly LocatedProject[]): { key: string; label: string } | null {
  const groups = new Map<string, { count: number; latest: Date; label: string }>();
  for (const project of projects) {
    const key = locationKey(project.location);
    if (key === null) continue;
    const group = groups.get(key) ?? { count: 0, latest: project.createdAt, label: project.location!.trim() };
    group.count += 1;
    if (project.createdAt >= group.latest) {
      group.latest = project.createdAt;
      group.label = project.location!.trim();
    }
    groups.set(key, group);
  }
  let best: { key: string; count: number; latest: Date; label: string } | null = null;
  for (const [key, group] of groups) {
    if (best === null || group.count > best.count || (group.count === best.count && group.latest > best.latest)) best = { key, ...group };
  }
  return best ? { key: best.key, label: best.label } : null;
}
