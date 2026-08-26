-- ---------------------------------------------------------------------------
-- 0009_import_file_contents.sql
--
-- Adds: import_files.content — the uploaded bytes, for deployments with no
-- object store — and a CHECK tying it to what storage_ref claims.
--
-- Depends on: 0005 (import_files).
-- Depended on by: the upload path, which cannot record a file it has nowhere
-- to put.
--
-- Spec: Master Technical Buildout section 10. ADR 0002. CLAUDE.md invariant 3.
--
-- ## Why the bytes may live in the database
--
-- `storage_ref` has always been NOT NULL, which is right: a district's export is
-- evidence, and a row claiming an import whose file cannot be produced again is
-- a provenance chain with a hole in it. The intended store is Vercel Blob and
-- then S3 (ADR 0002), and neither is configured on every deployment.
--
-- The alternative to this column was to refuse uploads until an object store
-- exists. That is defensible for evidence documents, which are large and
-- numerous. It is the wrong trade for a district fiscal export, which is a
-- single row of a few dozen columns — kilobytes — and which the platform
-- already stores field by field in `raw_records` anyway. Refusing to keep the
-- original while keeping every value parsed out of it protects nothing.
--
-- So `content` is nullable and `storage_ref` says which world the file is in:
--
--   'inline:sha256:<hash>'  the bytes are in this row
--   anything else            the bytes are in an object store at that locator
--
-- The CHECK makes those two the same statement, so a row cannot claim an
-- external object and carry bytes, or claim inline storage and carry none.
-- Without it the column would be an invitation to drift: code that wrote the
-- bytes and forgot the ref, or moved a file to S3 and left the bytes behind.
--
-- ## Expand, not contract
--
-- Additive and nullable, so the existing table and every reader of it keep
-- working. Nothing is backfilled: there are no rows yet, and a deployment that
-- later moves to object storage sets `storage_ref` and clears `content` in the
-- same statement the CHECK already governs.

ALTER TABLE import_files
  ADD COLUMN content bytea;

COMMENT ON COLUMN import_files.content IS
  'The uploaded bytes, when no object store is configured. NULL when storage_ref '
  'points at one. See the CHECK below, which keeps the two consistent.';

ALTER TABLE import_files
  ADD CONSTRAINT import_files_content_matches_ref
  CHECK ((storage_ref LIKE 'inline:%') = (content IS NOT NULL));
