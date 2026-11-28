import { IconButton, PrimaryButton, Stack, StackItem } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Connect } from "./components/Connect";
import { Nav } from "./components/Nav";
import { i18n } from "./state/i18n";
import { DeviceInfoPage } from "./pages/DeviceInfo";
import { FileManagerPage } from "./pages/FileManager";
import { InstallPage } from "./pages/Install";
import { LogcatPage } from "./pages/Logcat";
import { MirrorPage } from "./pages/Mirror";
import { PowerPage } from "./pages/Power";
import { PrivilegePage } from "./pages/Privilege";
import { ReadmePage } from "./pages/Readme";
import { ScreenCapturePage } from "./pages/ScreenCapture";
import { TerminalPage } from "./pages/Terminal";
import { TestScriptPage } from "./pages/TestScript";
import { WifiAdbPage } from "./pages/WifiAdb";
import { useRoute } from "./state/router";

const titleStyle = {
    fontSize: "20px",
    textAlign: "center" as const,
    padding: "4px 0",
    fontWeight: 600,
    color: "#323130",
};

export const App = observer(function App() {
    const [leftVisible, setLeftVisible] = useState(
        typeof window !== "undefined" ? window.innerWidth > 650 : true,
    );
    const route = useRoute();
    const t = i18n.t;

    useEffect(() => {
        const onResize = () => setLeftVisible(window.innerWidth > 650);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    let page: JSX.Element;
    switch (route) {
        case "device-info":
            page = <DeviceInfoPage />;
            break;
        case "file-manager":
            page = <FileManagerPage />;
            break;
        case "screen-capture":
            page = <ScreenCapturePage />;
            break;
        case "terminal":
            page = <TerminalPage />;
            break;
        case "mirror":
            page = <MirrorPage />;
            break;
        case "logcat":
            page = <LogcatPage />;
            break;
        case "test-script":
            page = <TestScriptPage />;
            break;
        case "install":
            page = <InstallPage />;
            break;
        case "privilege":
            page = <PrivilegePage />;
            break;
        case "power":
            page = <PowerPage />;
            break;
        case "wifi-adb":
            page = <WifiAdbPage />;
            break;
        default:
            page = <ReadmePage />;
    }

    return (
        <Stack verticalFill styles={{ root: { overflow: "hidden" } }}>
            {/* 顶栏 */}
            <Stack
                horizontal
                verticalAlign="center"
                styles={{
                    root: {
                        borderBottom: "1px solid rgb(243, 242, 241)",
                        flexShrink: 0,
                        padding: "4px 8px",
                    },
                }}
            >
                <IconButton
                    title={t.toggleMenu}
                    iconProps={{ iconName: "GlobalNavButton" }}
                    checked={leftVisible}
                    onClick={() => setLeftVisible((v) => !v)}
                />

                <StackItem grow>
                    <div style={titleStyle}>{t.appName}</div>
                </StackItem>

                <IconButton
                    title={i18n.lang === "zh" ? "Switch to English" : "切换到中文"}
                    onClick={() => i18n.toggle()}
                    styles={{
                        root: {
                            height: 32,
                            minWidth: 44,
                            fontWeight: 600,
                            color: "#0078d4",
                        },
                    }}
                >
                    {i18n.lang === "zh" ? "中" : "EN"}
                </IconButton>

                <IconButton
                    iconProps={{ iconName: "Feedback" }}
                    title={t.feedback}
                    onClick={() =>
                        window.open(
                            "https://github.com/Y-3614/AndroidDeviceStudio/issues/new",
                            "_blank",
                        )
                    }
                />
            </Stack>

            {/* 主体：左侧栏 + 内容区 */}
            <Stack
                horizontal
                grow
                disableShrink
                styles={{
                    root: {
                        minHeight: 0,
                        overflow: "hidden",
                        lineHeight: "1.5",
                    },
                }}
            >
                {leftVisible && (
                    <StackItem
                        styles={{
                            root: {
                                width: 270,
                                paddingRight: 8,
                                borderRight: "1px solid rgb(243, 242, 241)",
                                overflowY: "auto",
                                flexShrink: 0,
                            },
                        }}
                    >
                        <Connect />
                        <Nav current={route} />
                    </StackItem>
                )}

                <StackItem
                    grow
                    styles={{ root: { width: 0, height: "100%" } }}
                >
                    {page}
                </StackItem>
            </Stack>
        </Stack>
    );
});
