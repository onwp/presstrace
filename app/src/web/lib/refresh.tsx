import { createContext, useContext, useState, type ReactNode } from "react";

const RefreshContext = createContext<{ key: number; refresh: () => void }>({ key: 0, refresh: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState(0);
  return <RefreshContext.Provider value={{ key, refresh: () => setKey((k) => k + 1) }}>{children}</RefreshContext.Provider>;
}

export const useRefreshKey = () => useContext(RefreshContext).key;
export const useRefresh = () => useContext(RefreshContext).refresh;
