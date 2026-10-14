import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MolRow } from "../../../bindings/MolRow";
import type { RunSummary } from "../../../bindings/RunSummary";
import { call } from "../../../shared/lib/ipc";

const PAGE = 5000;

export function useRuns() {
  return useQuery({ queryKey: ["runs"], queryFn: () => call<RunSummary[]>("list_runs") });
}

export function useRun(runId: number) {
  return useQuery({ queryKey: ["run", runId], queryFn: () => call<RunSummary>("get_run", { runId }) });
}

export function useRunRows(runId: number) {
  return useQuery({
    queryKey: ["run-rows", runId],
    staleTime: Infinity,
    queryFn: async () => {
      const rows: MolRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await call<MolRow[]>("get_run_rows", { runId, offset, limit: PAGE });
        rows.push(...page);
        if (page.length < PAGE) return rows;
      }
    },
  });
}

function useRunMutation<V>(fn: (v: V) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "runs" || q.queryKey[0] === "run" }),
  });
}

export const useRenameRun = () => useRunMutation((v: { runId: number; name: string }) => call("rename_run", v));
export const useSetThreshold = () =>
  useRunMutation((v: { runId: number; threshold: number }) => call("set_run_threshold", v));
export const useDeleteRun = () => useRunMutation((v: { runId: number }) => call("delete_run", v));
