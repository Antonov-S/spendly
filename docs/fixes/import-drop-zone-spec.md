# Fix Spec: Unified Import Drop Zone

> **✅ Shipped (`fix/import-drop-zone`).** The format toggle is gone; `/import` now has a single
> drag-and-drop drop zone that accepts either type and auto-detects CSV vs JSON from the filename
> extension (click-to-browse retained). New pure helper `detectImportFormat` in
> `src/lib/import/format.ts` (extension-only, case-insensitive, whitespace-tolerant; unknown →
> `null` → inline "Unsupported file — drop a .csv or .json file." error). `import-flow.tsx`:
> toggle removed, `format` derived in `handleFile`, `reset()` arg dropped, `isDragging` +
> HTML5 drag handlers added, permissive `accept`. No schema/Server Action/pipeline change. 5 new
> tests in `test/lib/import/format.test.ts` — 705 total pass, build + lint clean.

The `/import` flow (shipped in `feature/data-import`, POST-MVP §15) currently makes the user
**pick a CSV / JSON format toggle first**, then click a file picker whose `accept` and label
adapt to that toggle. This fix replaces the manual toggle + click-only picker with **one
drag-and-drop drop zone that accepts either file type and auto-detects the format** from the
file's extension. The toggle is removed; format becomes derived, not chosen.

This is **UI polish only** — no schema change, no migration, no change to the three Server
Actions (`inspectCsv` / `previewImport` / `commitImport`) or the `src/lib/import/*` pipeline,
which already branch on format internally. The only non-component change is one small pure
helper (with a Vitest test).

Branch: `fix/import-drop-zone`

---

## Current behaviour

[import-flow.tsx](../../src/components/import/import-flow.tsx):

- A **format toggle** (`CSV` / `JSON` pill pair) drives a `format` state —
  [import-flow.tsx:175-191](../../src/components/import/import-flow.tsx#L175-L191). Switching it
  calls `reset(f)`, wiping any in-progress upload.
- The **upload control** is a `<label>` wrapping a hidden `<input type="file">` —
  [import-flow.tsx:194-209](../../src/components/import/import-flow.tsx#L194-L209). It is
  **click-to-browse only** (no drag-and-drop). Its `accept`, heading, and hint string are all
  keyed off the current `format`:
  - `accept={format === "csv" ? ".csv,text/csv" : ".json,application/json"}`
  - heading: `Choose a {FORMAT} file`
  - hint: `Up to 10 MB · {any column layout | Spendly JSON export}`

So the user must correctly classify their own file before the UI will accept it, and cannot
drag a file in. The information needed to pick the format (the file's extension) is something
the app can read itself.

---

## Desired behaviour

- **One drop zone**, no format toggle. The user drags a file onto it (or clicks to browse), and
  the app **detects** CSV vs JSON from the filename extension and proceeds exactly as the
  matching toggle would today.
- **Drag-and-drop** is supported, with a visible "drag active" highlight while a file is over
  the zone. Click-to-browse still works (accessibility / no-drag users).
- An **unrecognized extension** is rejected with a friendly inline error rather than a silent
  guess — the user keeps the current `error` surface in the upload step.

Everything downstream (CSV inspect → column mapper → configure → preview → confirm; JSON →
configure → preview → confirm) is **unchanged** — it already keys off the `format` value, which
is now set by detection instead of by the toggle.

---

## Fix

### 1. New pure helper — `detectImportFormat`

Add `src/lib/import/format.ts`:

```ts
import type { ImportFormat } from "@/types/import";

/**
 * Detect the import format from a filename's extension. Case-insensitive,
 * extension-only (the dropped/picked File always carries a name). Returns
 * null for anything that is not a recognized .csv / .json file so the caller
 * can reject it rather than guess.
 */
export function detectImportFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  return null;
}
```

- Lives in `src/lib/import/` alongside the existing pipeline modules; pure and string-only so it
  is trivially unit-testable (no `File` needed).
- Extension-based by design — robust enough for real exports and avoids an async content read.
  Content-sniffing (`{`/`[` → JSON) is **explicitly out of scope** (see *What we are not doing*).

> Reuse note: if a single-sourced `accept` string is wanted, add an `IMPORT_ACCEPT = ".csv,.json,text/csv,application/json"` constant to `src/lib/constants.ts` and reference it from the input. Optional — inline is acceptable for one call site. Do not scatter the literal.

### 2. Component changes — `import-flow.tsx`

**Remove the format toggle** block ([import-flow.tsx:175-191](../../src/components/import/import-flow.tsx#L175-L191)) entirely.

**Format becomes derived.** Keep the `format` state (downstream `buildOpts` / `handleFile` /
the configure section still read it), but it is now set by detection on file selection, never by
a toggle. Its initial value is irrelevant pre-upload (nothing reads it until a file exists);
keep `useState<ImportFormat>("csv")` for type simplicity.

**`reset()` drops its format argument.** It currently takes `nextFormat` only to serve the
toggle ([import-flow.tsx:78-91](../../src/components/import/import-flow.tsx#L78-L91)). With the
toggle gone, `reset()` takes no args and leaves `format` at whatever it was (or resets to
`"csv"` — either is fine since the next dropped file overwrites it). The "Import another" button
([import-flow.tsx:350](../../src/components/import/import-flow.tsx#L350)) calls `reset()`
unchanged.

**`handleFile` detects format first.** Prepend detection; reject unknown extensions:

```tsx
function handleFile(selected: File | null) {
  setError(null);
  setPreview(null);
  setResult(null);
  if (!selected) {
    setFile(null);
    setStep("upload");
    return;
  }
  const detected = detectImportFormat(selected.name);
  if (!detected) {
    setFile(null);
    setStep("upload");
    setError("Unsupported file — drop a .csv or .json file.");
    return;
  }
  setFormat(detected);
  setFile(selected);
  if (detected === "json") {
    setStep("configure");
    return;
  }
  // CSV → inspect to seed the mapper.
  startTransition(async () => {
    const res = await inspectCsv(formDataFor(selected));
    if (res.success) {
      setInspection(res.data);
      setMapping(res.data.suggestedMapping);
      setDateFormat(res.data.dialect.dateFormat);
      setDecimal(res.data.dialect.decimal);
      setStep("configure");
    } else {
      setError(res.error);
    }
  });
}
```

(Note: `setFile`/state ordering mirrors the current handler; the CSV branch passes `selected`
directly to `inspectCsv`, not the async `file` state — same as today.)

**Drop zone markup.** Add an `isDragging` state and HTML5 drag handlers to the upload section.
Keep the click-to-browse `<label>` + hidden input; the input's `onChange` still calls
`handleFile`. Generalize the copy and `accept`:

```tsx
const [isDragging, setIsDragging] = useState(false);

function onDrop(e: React.DragEvent) {
  e.preventDefault();
  setIsDragging(false);
  handleFile(e.dataTransfer.files?.[0] ?? null);
}

// in JSX — the upload <section>:
<section className={sectionClass}>
  <label
    onDragOver={(e) => {
      e.preventDefault();
      setIsDragging(true);
    }}
    onDragLeave={() => setIsDragging(false)}
    onDrop={onDrop}
    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
      isDragging
        ? "border-success bg-success/10"
        : "border-line bg-surface-2 hover:border-success/50"
    }`}
  >
    <Upload size={20} className="text-ink-2" />
    <span className="text-[13px] font-medium text-ink">
      {file ? file.name : "Drop a CSV or JSON file, or click to browse"}
    </span>
    <span className="text-[11px] text-ink-3">
      Up to 10 MB · CSV (any column layout) or a Spendly JSON export
    </span>
    <input
      type="file"
      accept=".csv,.json,text/csv,application/json"
      className="hidden"
      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
    />
  </label>
  {error && step === "upload" && (
    <p className="mt-3 text-[12px] text-danger">{error}</p>
  )}
</section>
```

- The `onDragOver` **must** `preventDefault()` or the browser opens the file instead of firing
  `onDrop`.
- The `accept` is now permissive across both types; detection in `handleFile` is the real gate
  (a user can still drag a `.txt` past the picker filter — that hits the "Unsupported file"
  branch).

**Update the component doc comment** ([import-flow.tsx:50-55](../../src/components/import/import-flow.tsx#L50-L55)): drop "format toggle → upload" and describe the unified drop zone — e.g. *"Flow: drop/choose a file (format auto-detected) → configure (CSV adds a column mapper) → preview → confirm."*

**Import the helper:** `import { detectImportFormat } from "@/lib/import/format";`.

No prop changes to `ImportFlowProps`; the page (`src/app/import/page.tsx`) is untouched.

---

## What we are not doing

- **Not** changing any Server Action, the `src/lib/import/*` parsing pipeline, validations,
  types, dedup, or DB write. The server still receives `format` in `ImportOptions` exactly as
  before — it is merely derived client-side now.
- **Not** content-sniffing file bytes to detect format. Extension-only; unknown → reject. (The
  server actions already validate the actual content and surface a real error if, say, a
  `.json`-named file isn't a valid envelope.)
- **Not** supporting multi-file drop. Single file only (`files?.[0]`), matching today.
- **Not** adding a schema change, migration, Pro gate, or new route. No change to rate limiting.
- **Not** touching `ColumnMapper`, `ImportPreview`, or the configure/preview/done steps.

---

## Testing

### Unit (Vitest)

Add `test/lib/import/format.test.ts` for `detectImportFormat` — the one new logic surface:

- `"statement.csv"` → `"csv"`; `"export.json"` → `"json"`.
- Case-insensitive: `"DATA.CSV"` → `"csv"`, `"Backup.JSON"` → `"json"`.
- Compound / dotted names: `"2026.q1.csv"` → `"csv"`, `"my.export.json"` → `"json"`.
- Unknown / missing extension → `null`: `"notes.txt"`, `"archive.zip"`, `"README"`, `""`.
- Trailing/leading whitespace tolerated (`" data.csv "` → `"csv"`).

Per project standards, components are **not** unit-tested — the drop-zone markup and handler
wiring are verified manually. Existing import suites must stay green (`npm run test:run`).

### Build / lint

`npm run build` and `npm run lint` must pass — ESLint `no-unused-vars` confirms the removed
toggle left no orphaned symbols (e.g. the `reset(f)` arg, any now-unused state).

### Manual

1. `/import` (with at least one active account) shows **no format toggle** — just the drop zone.
2. **Drag** a `.csv` onto the zone → border highlights while dragging → on drop it inspects and
   advances to the column mapper (CSV configure step).
3. **Drag** a Spendly `.json` export → advances straight to configure (no mapper), then
   preview → confirm imports correctly.
4. **Click** the zone (no drag) → native picker → choosing either type works identically.
5. **Drag an unsupported file** (e.g. `.txt`) → inline error *"Unsupported file — drop a .csv or
   .json file."*, no step change, no crash.
6. Run a full CSV import and a full JSON import end-to-end; confirm the imported counts match
   pre-fix behaviour (detection-only change, no pipeline change).
7. Zero-account empty state on `/import` is unaffected.
