import { useEffect, useRef } from "react";

/**
 * 轻量实时折线图（Canvas 绘制，不引入图表库）。
 *
 * - 支持多条曲线（不同颜色）；
 * - 自动按数据范围缩放 Y 轴（带少量留白）；
 * - 支持 Y 轴单位、最大值上限（如 100%）；
 * - 数据更新即重绘，用于 CPU / 内存实时曲线。
 */
export interface LineSeries {
    /** 系列名（图例用） */
    name: string;
    /** 颜色 */
    color: string;
    /** 数据点 */
    data: number[];
}

export function LineChart({
    series,
    height = 140,
    unit = "%",
    maxY,
    minY = 0,
    /** 是否在最高点标注具体数值 */
    markPeak = true,
}: {
    series: LineSeries[];
    height?: number;
    unit?: string;
    /** Y 轴上限；不传则按数据自适应 */
    maxY?: number;
    minY?: number;
    markPeak?: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 600;
        const cssH = height;
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        const padL = 44;
        const padR = 12;
        const padT = 16;
        const padB = 20;
        const plotW = cssW - padL - padR;
        const plotH = cssH - padT - padB;

        // 数据范围
        const allData = series.flatMap((s) => s.data);
        const dataMax = allData.length ? Math.max(...allData) : 100;
        const dataMin = allData.length ? Math.min(...allData) : 0;
        const yTop = maxY ?? Math.max(dataMax * 1.15, 10);
        const yBot = Math.min(minY, dataMin >= 0 ? minY : dataMin);
        const span = Math.max(1, yTop - yBot);

        const maxLen = Math.max(1, ...series.map((s) => s.data.length));
        const xAt = (i: number) => padL + (plotW * i) / Math.max(1, maxLen - 1);
        const yAt = (v: number) => padT + plotH * (1 - (v - yBot) / span);

        // 背景网格 + Y 轴刻度
        ctx.strokeStyle = "#edebe9";
        ctx.fillStyle = "#a19f9d";
        ctx.font = "10px Consolas, Menlo, monospace";
        ctx.lineWidth = 1;
        const ticks = 4;
        for (let i = 0; i <= ticks; i++) {
            const v = yBot + (span * i) / ticks;
            const y = yAt(v);
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(cssW - padR, y);
            ctx.stroke();
            ctx.fillText(`${v.toFixed(0)}${unit}`, 4, y + 3);
        }

        // 各系列折线
        for (const s of series) {
            if (s.data.length === 0) continue;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            s.data.forEach((v, i) => {
                const x = xAt(i);
                const y = yAt(v);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // 末端点 + 数值
            const lastX = xAt(s.data.length - 1);
            const lastY = yAt(s.data[s.data.length - 1]!);

            // 最高点标注
            if (markPeak && s.data.length > 1) {
                const peak = Math.max(...s.data);
                const peakI = s.data.indexOf(peak);
                const px = xAt(peakI);
                const py = yAt(peak);
                // 高亮点
                ctx.fillStyle = s.color;
                ctx.beginPath();
                ctx.arc(px, py, 3.5, 0, Math.PI * 2);
                ctx.fill();
                // 数值标签
                const label = `${peak.toFixed(1)}${unit}`;
                ctx.font = "10px Consolas, Menlo, monospace";
                const tw = ctx.measureText(label).width;
                const lx = Math.max(padL, Math.min(px - tw / 2, cssW - padR - tw));
                const ly = Math.max(padT + 10, py - 6);
                ctx.fillStyle = "rgba(255,255,255,0.85)";
                ctx.fillRect(lx - 3, ly - 10, tw + 6, 13);
                ctx.fillStyle = s.color;
                ctx.fillText(label, lx, ly);
            }

            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // X 轴时间（取首尾）
        ctx.fillStyle = "#a19f9d";
        const total = maxLen;
        ctx.fillText("0", padL, cssH - 6);
        if (total > 1) {
            const label = `${total} 点`;
            const w = ctx.measureText(label).width;
            ctx.fillText(label, cssW - padR - w, cssH - 6);
        }
        // 图例
        let lx = padL + 4;
        for (const s of series) {
            ctx.fillStyle = s.color;
            ctx.fillRect(lx, padT - 10, 10, 4);
            ctx.fillStyle = "#605e5c";
            const label = s.name;
            ctx.fillText(label, lx + 14, padT - 5);
            lx += 16 + ctx.measureText(label).width + 14;
        }
    }, [series, height, unit, maxY, minY, markPeak]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: "100%",
                height,
                border: "1px solid #edebe9",
                borderRadius: 4,
                background: "#fff",
                display: "block",
            }}
        />
    );
}
