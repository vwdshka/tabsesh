// chrome.processes isn't covered by the webextension-polyfill types and @types/chrome
// isn't installed, so it's declared narrowly here for just the two calls used below
declare const chrome:
  | {
      processes?: {
        getProcessIdForTab(tabId: number, callback: (processId: number) => void): void;
        getProcessInfo(
          processIds: number[],
          includeMemory: boolean,
          callback: (result: Record<string, { privateMemory?: number; tasks?: { tabId?: number }[] }>) => void,
        ): void;
      };
    }
  | undefined;

// best-effort memory estimate for still-open tabs, call before closing them.
// splits a renderer process's memory across however many of our tabs share it,
// returns null if unavailable rather than guessing zero
export async function estimateMemoryFreed(tabIds: number[]): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.processes || tabIds.length === 0) return null;
  const processesApi = chrome.processes;

  try {
    const tabToProcess = new Map<number, number>();

    await Promise.all(
      tabIds.map(
        (tabId) =>
          new Promise<void>((resolve) => {
            try {
              processesApi.getProcessIdForTab(tabId, (processId) => {
                if (typeof processId === 'number') tabToProcess.set(tabId, processId);
                resolve();
              });
            } catch {
              resolve();
            }
          }),
      ),
    );

    const processIds = [...new Set(tabToProcess.values())];
    if (processIds.length === 0) return null;

    const infoMap = await new Promise<Record<string, { privateMemory?: number; tasks?: { tabId?: number }[] }>>(
      (resolve) => {
        try {
          processesApi.getProcessInfo(processIds, true, (result) => resolve(result ?? {}));
        } catch {
          resolve({});
        }
      },
    );

    let total = 0;
    for (const processId of processIds) {
      const info = infoMap[String(processId)];
      if (!info || typeof info.privateMemory !== 'number') continue;

      const tasksInProcess = Math.max(info.tasks?.length ?? 1, 1);
      const ourTabsInProcess = [...tabToProcess.values()].filter((pid) => pid === processId).length;
      const share = Math.min(ourTabsInProcess / tasksInProcess, 1);
      total += info.privateMemory * share;
    }

    return total > 0 ? Math.round(total) : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
