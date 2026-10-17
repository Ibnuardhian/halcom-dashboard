export type HealthReport = {
  status: "ok" | "unavailable";
  checks: { database: "ok" | "unavailable" };
};

/**
 * Builds the public health report. Failure details are logged server-side only;
 * the report never echoes driver errors or connection details to the caller.
 */
export async function getHealthReport(
  pingDatabase: () => Promise<unknown>,
): Promise<HealthReport> {
  try {
    await pingDatabase();
    return { status: "ok", checks: { database: "ok" } };
  } catch (error) {
    console.error(
      "[health] database check failed:",
      error instanceof Error ? error.message : error,
    );
    return { status: "unavailable", checks: { database: "unavailable" } };
  }
}
