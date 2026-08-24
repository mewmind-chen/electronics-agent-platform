/**
 * @electronics/contracts — the only type boundary shared by
 * Radar, Workbench, dsh-* plugins, and apps/agent-api.
 *
 * No @deepseek-ai imports. No SQL. No confirmImport.
 */
export {
  CONTRACT_VERSION,
  EXECUTION_MODES,
  SOURCE_KEYS,
  displayMpn,
  normalizeMpnKey,
  parseExecutionMode,
} from "./common.js";

export {
  IMPORT_KINDS,
  IMPORT_SOURCES,
  COLUMN_TARGETS,
  parseImportRequest,
  parseImportCandidate,
  parseImportResult,
  parseColumnMapping,
} from "./import.js";

export { parsePartResearchRequest, parsePartResearchResult, PART_SOURCE_STEPS } from "./part.js";

export {
  parseCompanyResearchRequest,
  parseCompanyResearchResult,
  COMPANY_TYPES,
  COMPANY_STEPS,
} from "./company.js";

export {
  parseClaim,
  parseEvidenceItem,
  parseVerdict,
  evidenceIdsExist,
} from "./evidence.js";

export {
  TASK_TYPES,
  TASK_STATUSES,
  parseTaskCreateRequest,
  parseTaskHandle,
  parseTaskEvent,
} from "./task.js";
