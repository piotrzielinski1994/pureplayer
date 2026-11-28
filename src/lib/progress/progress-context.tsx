import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { log } from "@/lib/logging/log";
import {
  clearProgress,
  type ProgressEntry,
  type ProgressMap,
} from "@/lib/progress/progress";
import type { ProgressStore } from "@/lib/progress/progress-store";

type ProgressContextValue = {
  progress: ProgressMap;
  recordProgress: (path: string, entry: ProgressEntry) => void;
  forgetProgress: (path: string) => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

type ProgressProviderProps = {
  store: ProgressStore;
  children: ReactNode;
};

// Blocks render until the file has loaded, mirroring SettingsProvider - the
// workspace reads the map synchronously to resume the first video it activates.
export function ProgressProvider({ store, children }: ProgressProviderProps) {
  const [progress, setProgress] = useState<ProgressMap | null>(null);

  useEffect(() => {
    let isMounted = true;
    log.info("progress: loading saved positions");
    store.load().then((loaded) => {
      if (isMounted) {
        log.info(`progress: loaded entries=${Object.keys(loaded).length}`);
        setProgress(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const recordProgress = useCallback(
    (path: string, entry: ProgressEntry) => {
      log.info(
        `progress: record path=${path} pos=${entry.positionSec.toFixed(2)}s`,
      );
      setProgress((current) => {
        const next = { ...(current ?? {}), [path]: entry };
        void store.save(next);
        return next;
      });
    },
    [store],
  );

  const forgetProgress = useCallback(
    (path: string) => {
      log.info(`progress: forget path=${path}`);
      setProgress((current) => {
        const next = clearProgress(current ?? {}, path);
        if (next !== current) {
          void store.save(next);
        }
        return next;
      });
    },
    [store],
  );

  const value = useMemo<ProgressContextValue | null>(
    () =>
      progress === null ? null : { progress, recordProgress, forgetProgress },
    [progress, recordProgress, forgetProgress],
  );

  if (value === null) {
    return null;
  }

  return (
    <ProgressContext.Provider value={value}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return value;
}
