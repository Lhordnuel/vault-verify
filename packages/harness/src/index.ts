/** Library surface (used by tests and future programmatic callers). */
export { finishRun, runTests, startRun, watchRun } from './commands.js';
export type { FinishOptions, FinishResult, RunTestsOptions, RunTestsResult, StartOptions, StartResult } from './commands.js';
export { parseTestCounts, runTestCommand } from './testcmd.js';
export type { TestCounts, TestRunResult } from './testcmd.js';
export { appendChainRecord, loadChainRecords } from './chainstore.js';
export type { ChainRecord } from './chainstore.js';
export { startWatch } from './watch.js';
export type { WatchHandle } from './watch.js';
export { HARNESS_COLLECTOR_ID, HARNESS_VERSION } from './config.js';
export type { RunSession } from './session.js';
