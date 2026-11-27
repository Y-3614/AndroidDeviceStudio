import { createTheme, loadTheme } from "@fluentui/react";

/**
 * 沿用原 Tango 旧版 Demo 的 Fluent 默认配色：
 * 主色 #0078d4、正文 #323130、次要 #605e5c、分隔 #f3f2f1。
 */
export const appTheme = createTheme({
    palette: {
        themePrimary: "#0078d4",
        themeDark: "#005a9e",
        themeDarkAlt: "#106ebe",
        neutralPrimary: "#323130",
        neutralSecondary: "#605e5c",
        neutralTertiary: "#a19f9d",
        neutralLight: "#edebe9",
        neutralLighter: "#f3f2f1",
        neutralLighterAlt: "#faf9f8",
    },
    defaultFontStyle: {
        fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
        fontSize: "14px",
    },
});

export function applyTheme() {
    loadTheme(appTheme);
}
