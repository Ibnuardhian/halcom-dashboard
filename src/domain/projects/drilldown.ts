import { FUNNEL_STEPS } from "./funnel";
import { PROJECT_PROGRESSES, TRACK_STATUSES, type ProjectProgress, type TrackStatus } from "./progress";

/**
 * What a chart on the Overview sends to the Projects list when one of its bars or slices is clicked. The values are plain URL
 * parameters, validated again by the page and the query; this module only builds and reads them, so the chart and the list agree.
 */

/** In a filter, "none" is the slice for projects without a value ("Not set"). */
export const FILTER_NONE = "none";
/** In the `owner` filter, "external" is the projects that have no internal Sales PIC (source Other). */
export const FILTER_EXTERNAL = "external";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

/** The filters the charts use. Several values for one filter mean "any of them" (the folded "Other" slice of a chart). */
export type DrillFilters = {
  progress?: ProjectProgress;
  status?: TrackStatus;
  /** A funnel step: every project that reached it (that step or a later one). */
  reached?: string;
  principal?: readonly string[];
  solution?: readonly string[];
  industry?: readonly string[];
  owner?: readonly string[];
};

/** The progress values of the projects that reached a funnel step; null for an unknown step. */
export function progressesReaching(stepKey: string): ProjectProgress[] | null {
  const index = FUNNEL_STEPS.findIndex((step) => step.key === stepKey);
  return index < 0 ? null : FUNNEL_STEPS.slice(index).flatMap((step) => step.members);
}

/** An industry as the charts group it: trimmed and lower-cased; null when there is none ("Not set"). */
export function industryKey(industry: string | null | undefined): string | null {
  const key = industry?.trim().toLowerCase();
  return key ? key : null;
}

const many = (value: string | string[] | undefined): string[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/**
 * Reads the chart filters out of a page's search parameters. Anything that is not a valid value is dropped, never guessed:
 * principals, solutions and owners are ids (or "none" / "external"), progress and status are the known codes.
 */
export function readDrillFilters(query: Record<string, string | string[] | undefined>): DrillFilters {
  const ids = (name: string, extra: readonly string[]) => [...new Set(many(query[name]).filter((value) => isUuid(value) || extra.includes(value)))];
  const industry = [...new Set(many(query["industry"]).map((value) => value.trim().toLowerCase().slice(0, 120)).filter((value) => value !== ""))];
  const reached = many(query["reached"])[0];
  const progress = PROJECT_PROGRESSES.find((value) => value === many(query["progress"])[0]);
  const status = TRACK_STATUSES.find((value) => value === many(query["status"])[0]);
  return {
    ...(progress ? { progress } : {}),
    ...(status ? { status } : {}),
    ...(reached && progressesReaching(reached) ? { reached } : {}),
    principal: ids("principal", [FILTER_NONE]),
    solution: ids("solution", [FILTER_NONE]),
    industry,
    owner: ids("owner", [FILTER_NONE, FILTER_EXTERNAL]),
  };
}

/** The Projects list address for a set of chart filters; `mine` keeps a salesperson's drill-down to their own projects. */
export function projectsHref(basePath: string, filters: DrillFilters, options: { mine?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (filters.progress) params.set("progress", filters.progress);
  if (filters.status) params.set("status", filters.status);
  if (filters.reached) params.set("reached", filters.reached);
  for (const name of ["principal", "solution", "industry", "owner"] as const) {
    for (const value of filters[name] ?? []) params.append(name, value);
  }
  if (options.mine) params.set("mine", "1");
  const text = params.toString();
  return text ? `${basePath}?${text}` : basePath;
}
