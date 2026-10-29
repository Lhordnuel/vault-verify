import { watch, type FSWatcher } from 'node:fs';

const IGNORED_SEGMENTS = new Set(['.git', '.vaultverify', 'node_modules']);

function isIgnored(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

export interface WatchHandle {
  stop: () => Promise<void>;
}

/** Watch a run dir and call onChange (debounced) for workspace file changes. */
export async function startWatch(
  runDir: string,
  onChange: () => Promise<void>,
  opts?: { debounceMs?: number; onError?: (error: unknown) => void },
): Promise<WatchHandle> {
  const debounceMs = opts?.debounceMs ?? 750;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const watcher: FSWatcher = watch(runDir, { recursive: true }, (_event, filename) => {
    if (stopped) return;
    if (typeof filename === 'string' && isIgnored(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange().catch((error: unknown) => opts?.onError?.(error));
    }, debounceMs);
  });
  watcher.on('error', (error: unknown) => opts?.onError?.(error));
  return {
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      watcher.close();
    },
  };
}
