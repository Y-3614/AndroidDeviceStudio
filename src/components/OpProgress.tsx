import { ProgressIndicator } from "@fluentui/react";
import { ProgressBar } from "../state/testscript";

/**
 * 操作进度条：显示百分比 + 描述 + 完成/失败反馈。
 * 由 store 中 progress[key] 驱动。
 */
export function OpProgress({ bar }: { bar: ProgressBar | undefined }) {
    if (!bar) return null;
    const color = !bar.done
        ? "#0078d4"
        : bar.ok
          ? "#107c10"
          : "#a4262c";
    const prefix = !bar.done ? "⏳" : bar.ok ? "✓" : "✗";
    return (
        <div style={{ marginTop: 6 }}>
            <ProgressIndicator
                percentComplete={bar.percent / 100}
                styles={{
                    progressBar: { background: color },
                    itemProgress: { background: color },
                }}
            />
            <div style={{ fontSize: 12, color, marginTop: 2 }}>
                {prefix} {bar.percent}% {bar.text}
            </div>
        </div>
    );
}
