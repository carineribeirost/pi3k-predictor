import { lazy, Suspense } from "react";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { useThemeKey } from "../theme";

const TargetView = lazy(() => import("../../features/target/ui/TargetView").then((m) => ({ default: m.TargetView })));

export function TargetPage() {
  const themeKey = useThemeKey();
  return (
    <ErrorBoundary area="target view">
      <Suspense fallback={<div className="empty">Loading the 3D viewer…</div>}>
        <TargetView themeKey={themeKey} />
      </Suspense>
    </ErrorBoundary>
  );
}
