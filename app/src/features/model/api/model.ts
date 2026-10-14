import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelStatus } from "../../../bindings/ModelStatus";
import type { ReferenceData } from "../../../bindings/ReferenceData";
import { call } from "../../../shared/lib/ipc";

export function useModelStatus() {
  const qc = useQueryClient();
  useEffect(() => {
    const pending = listen<ModelStatus>("model-status-changed", (e) => qc.setQueryData(["model-status"], e.payload));
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [qc]);
  return useQuery({ queryKey: ["model-status"], queryFn: () => call<ModelStatus>("model_status") });
}

export function useReference(enabled: boolean) {
  return useQuery({
    queryKey: ["reference"],
    queryFn: () => call<ReferenceData>("reference_data"),
    enabled,
    staleTime: Infinity,
  });
}
