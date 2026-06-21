import { EXPORT_JSON_SCHEMA_VERSION } from "@/lib/system-constants";
import type { ExportEnvelope } from "@/types/export";

/**
 * Wrap an export payload in the versioned envelope (data-export-spec §6.1). Pure
 * — no Prisma, no HTTP. The bare object is never emitted: `schemaVersion` lets a
 * future importer detect the format generation before parsing (§6.2). `now` is
 * injectable so tests can assert a fixed `exportedAt`.
 */
export function buildExportEnvelope<T>(
  data: T,
  now: Date = new Date()
): ExportEnvelope<T> {
  return {
    schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data,
  };
}
