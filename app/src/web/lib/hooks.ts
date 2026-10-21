import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { parseRange, type RangeKey } from "../../shared/range";
import { api } from "./api";
import { useRefreshKey } from "./refresh";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches JSON for a path; refetches when the path or the global refresh key changes. */
export function useApi<T>(path: string | null): ApiState<T> {
  const refreshKey = useRefreshKey();
  // The path is stored with the data so a new path never shows the previous path's data.
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null; loading: boolean }>({
    path,
    data: null,
    error: null,
    loading: path !== null,
  });
  const [local, setLocal] = useState(0);
  const reload = useCallback(() => setLocal((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setState((s) => (s.path === path ? { ...s, loading: true, error: null } : { path, data: null, error: null, loading: true }));
    api<T>(path, { signal: ctrl.signal })
      .then((data) => setState({ path, data, error: null, loading: false }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, path, error: e instanceof Error ? e.message : String(e), loading: false }));
      });
    return () => ctrl.abort();
  }, [path, refreshKey, local]);

  const current = state.path === path;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: path !== null && (!current || state.loading),
    reload,
  };
}

export function useRange(): [RangeKey, (r: RangeKey) => void] {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get("range"));
  const set = useCallback(
    (r: RangeKey) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("range", r);
          next.delete("page");
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  return [range, set];
}

/** Width of an element, updated on resize, for charts drawn in pixels. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.floor(w));
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} - PressTrace` : "PressTrace";
  }, [title]);
}
