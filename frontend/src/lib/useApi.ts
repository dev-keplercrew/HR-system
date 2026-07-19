import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Standard data-fetching hook used by every page: handles loading, error and
// re-fetch. Pass a fetcher and a dependency list (like useEffect).
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    run()
      .then((res) => {
        if (live) setData(res);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
