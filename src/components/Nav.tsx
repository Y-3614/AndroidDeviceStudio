import { Nav as FluentNav, type INavLinkGroup } from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { i18n } from "../state/i18n";
import { router, type Route } from "../state/router";

interface RouteDef {
    key: Route;
    icon: string;
    labelKey: keyof typeof i18n.t.nav;
}

/**
 * 左侧导航。
 * 注意：图标名必须存在于 Fluent UI MDL2 图标集中
 * （不存在的名字会渲染成空白，之前正是踩了这个坑）。
 */
const ROUTES: RouteDef[] = [
    { key: "readme", icon: "Bookmarks", labelKey: "readme" },
    { key: "device-info", icon: "Phone", labelKey: "deviceInfo" },
    { key: "file-manager", icon: "Folder", labelKey: "fileManager" },
    { key: "privilege", icon: "Shield", labelKey: "privilege" },
    { key: "power", icon: "PowerButton", labelKey: "power" },
    { key: "wifi-adb", icon: "NetworkTower", labelKey: "wifiAdb" },
    { key: "terminal", icon: "CommandPrompt", labelKey: "terminal" },
    { key: "commands", icon: "Library", labelKey: "commands" },
    { key: "mirror", icon: "Devices2", labelKey: "mirror" },
    { key: "screen-capture", icon: "Camera", labelKey: "screenCapture" },
    { key: "logcat", icon: "Articles", labelKey: "logcat" },
    { key: "test-script", icon: "Script", labelKey: "testScript" },
    { key: "install", icon: "Package", labelKey: "install" },
];

export const Nav = observer(function Nav({ current }: { current: Route }) {
    const t = i18n.t;
    const groups: INavLinkGroup[] = [
        {
            links: ROUTES.map((r) => ({
                name: t.nav[r.labelKey],
                key: r.key,
                url: `#/${r.key}`,
                icon: r.icon,
            })),
        },
    ];

    return (
        <FluentNav
            groups={groups}
            selectedKey={current}
            onLinkClick={(e, item) => {
                e?.preventDefault();
                if (item?.key) router.navigate(item.key as Route);
            }}
            styles={{
                root: { width: "100%" },
                link: { height: 44, lineHeight: "44px" },
            }}
        />
    );
});
