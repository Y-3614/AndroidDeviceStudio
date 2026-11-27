import { initializeIcons } from "@fluentui/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";
import { applyTheme } from "./theme";

/**
 * 图标字体必须指向**本地**资源。
 *
 * 默认的 initializeIcons() 会从微软 CDN（res.cdn.office.net）加载 woff 字体，
 * 国内网络经常加载失败，表现为图标空白或错乱。
 * 这里把字体文件放在 public/fabric-icons/ 下，用相对路径加载，纯离线可用。
 */
initializeIcons(`${import.meta.env.BASE_URL}fabric-icons/`);
applyTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
