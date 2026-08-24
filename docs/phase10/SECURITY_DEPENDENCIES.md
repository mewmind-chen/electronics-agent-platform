# Phase 10 — Import dependency security

The public npm registry's `xlsx@0.18.5` is affected by prototype-pollution and
regular-expression denial-of-service advisories. SheetJS publishes current
Community Edition releases from its own authoritative CDN, so Import Core pins
the exact official `xlsx-0.20.3.tgz` URL instead of a floating npm range.

`tests/phase10/security-dependencies.test.mjs` is the release gate: it resolves
the package from Import Core's own module boundary, requires version `0.20.3`,
builds a real XLSX workbook and parses it through `parseExcelBase64`. The Docker
install disables npm's advisory request because npm treats URL dependencies as
an unconstrained package and reports a false positive even when the installed
package metadata is version 0.20.3. It does not disable the version or behavior
gate.

Primary installation reference:
https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
