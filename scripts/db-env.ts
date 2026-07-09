// The development branch endpoint (from DATABASE_URL). Anything else is treated
// as production for safety.
export const DEV_ENDPOINT_MARKER = "ep-nameless-resonance-aqvflbsf";

export function parseHost(connectionString: string | undefined): string {
  if (!connectionString) return "(unknown - DATABASE_URL unset)";
  try {
    return new URL(connectionString).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export function looksProduction(host: string): boolean {
  return !host.includes(DEV_ENDPOINT_MARKER);
}
