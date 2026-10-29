/** Library surface (used by tests and future programmatic callers). */
export { finishRun, importLogRun, runTests, startRun, watchRun } from './commands.js';
export type {
  FinishOptions,
  FinishResult,
  ImportLogRunOptions,
  ImportLogRunResult,
  RunTestsOptions,
  RunTestsResult,
  StartOptions,
  StartResult,
} from './commands.js';
export { importLog } from './importer.js';
export type { ImportLogOptions, ImportRegistryEntry, ImportResult } from './importer.js';
export { agentLogV1Parser, detectParser, knownFormats, PARSER_REGISTRY } from './parsers.js';
export type { FormatParser, RawLogEntry } from './parsers.js';
export { parseTestCounts, runTestCommand } from './testcmd.js';
export type { TestCounts, TestRunResult } from './testcmd.js';
export { appendChainRecord, loadChainRecords } from './chainstore.js';
export type { ChainRecord } from './chainstore.js';
export { startWatch } from './watch.js';
export type { WatchHandle } from './watch.js';
export { HARNESS_COLLECTOR_ID, HARNESS_VERSION } from './config.js';
export type { RunSession } from './session.js';
