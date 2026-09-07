import { useSyncExternalStore } from "react";
import { appearance, type AppearanceMode } from "./appearance.js";
export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { mode, saved } = useSyncExternalStore(
    appearance.subscribe,
    appearance.getSnapshot,
  );
  return (
    <div className={`theme-control ${compact ? "compact" : ""}`}>
      <label>
        <span>{compact ? "테마" : "화면 테마"}</span>
        <select
          aria-label={compact ? "상단 화면 테마" : "설정 화면 테마"}
          value={mode}
          onChange={(e) => appearance.set(e.target.value as AppearanceMode)}
        >
          <option value="system">시스템</option>
          <option value="light">라이트</option>
          <option value="dark">다크</option>
        </select>
      </label>
      {!saved && (
        <small role="status">
          테마를 저장하지 못했습니다. 현재 창에만 적용됩니다.
        </small>
      )}
    </div>
  );
}
