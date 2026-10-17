"use client";

import { useEffect } from "react";
import { useInventoryStore } from "@/store/useInventoryStore";
import { cloudEnabled } from "@/lib/auth-client";

export default function InventorySync() {
  const { refresh, syncError, actionError, clearError, loaded } = useInventoryStore();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, cloudEnabled ? 5000 : 1000);
    };
    void poll();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  const error = actionError || syncError;
  if (!error && loaded) return null;
  return (
    <div role={error ? "alert" : "status"} className="fixed bottom-0 left-0 right-0 z-[200] flex items-center justify-between gap-3 border-t bg-white p-3 text-sm shadow-lg">
      <span>{error || "Loading shared demo inventory. Controls will be enabled when synchronization is ready."}</span>
      {error && <button className="shrink-0 rounded border px-3 py-1" onClick={() => { clearError(); void refresh(); }}>Refresh</button>}
    </div>
  );
}
