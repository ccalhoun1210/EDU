-- ---------------------------------------------------------------------------
-- 0010_import_scan_status.sql
--
-- Adds: the malware-scan verdict an uploaded district export was admitted
-- under, and what produced it.
--
-- Depends on: 0005 (import_files).
-- Depended on by: the upload path, which must record what it was told about a
-- file rather than what it wished were true.
--
-- Spec: Master Technical Buildout section 10. Threat model, "Malicious file".
-- CLAUDE.md invariant 3.
--
-- ## Why the verdict is stored at all
--
-- `ImportRequest` has always required a `ScanResult`, and `runImport` refuses a
-- file that is not CLEAN. That gate is a precondition the type system enforces —
-- but until now nothing recorded what the gate was told. A monitor asking, in
-- eighteen months, whether this general ledger was ever scanned had nowhere to
-- look, because the answer lived in a transient issue list.
--
-- ## Why NOT_SCANNED
--
-- The threat model records the gate as real and the thing behind it as absent:
-- no scanner is wired up, so a caller states what the scan concluded. Under
-- section 15's vocabulary an unscanned upload would have to claim PENDING — a
-- promise that something will look at it, which nothing will — or CLEAN, a
-- verdict nothing reached. Both are false, and a false line in the evidentiary
-- record is worse than an acknowledged gap: the product rests on a stored
-- artifact meaning what it says.
--
-- NOT_SCANNED is terminal and honest. It is not a way around the gate:
-- `runImport` still refuses it unless the caller sets `acknowledgeUnscanned`,
-- and an import admitted that way carries a FILE_NOT_SCANNED warning onto every
-- screen that renders it. The column is the gate saying what it let past.
--
-- The vocabulary is `IMPORT_SCAN_STATUSES`, deliberately separate from
-- `MALWARE_SCAN_STATUSES` on evidence_items. Evidence documents go through a
-- different pipeline under a different operator, and a value one of them may
-- hold is not automatically one the other should.
--
-- ## Expand, not contract
--
-- Three columns, all additive; the status defaults to PENDING, which is what an
-- existing row would honestly say. There are no existing rows, and no reader of
-- import_files needs changing.

ALTER TABLE import_files
  ADD COLUMN scan_status text NOT NULL DEFAULT 'PENDING'
    CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'FAILED', 'NOT_SCANNED')),
  ADD COLUMN scanner text,
  ADD COLUMN scanned_at timestamptz;

COMMENT ON COLUMN import_files.scan_status IS
  'The verdict this file was admitted under. NOT_SCANNED means no scanner was '
  'configured and the deployment accepted it explicitly — never that one is pending.';

COMMENT ON COLUMN import_files.scanner IS
  'What produced the verdict, or none-configured. Recorded rather than inferred: '
  '"scanned" is only meaningful if you can say by what.';

-- A scanner name and a time are what make a verdict checkable. A row claiming
-- CLEAN with nothing to attribute it to is the same unattributed assertion the
-- provenance chain exists to prevent, so the three columns move together.
ALTER TABLE import_files
  ADD CONSTRAINT import_files_scan_attributed
  CHECK (
    (scan_status = 'PENDING' AND scanner IS NULL AND scanned_at IS NULL)
    OR
    (scan_status <> 'PENDING' AND scanner IS NOT NULL AND scanned_at IS NOT NULL)
  );
