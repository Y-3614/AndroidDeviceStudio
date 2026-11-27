import {
    DetailsList,
    DetailsListLayoutMode,
    MessageBar,
    SelectionMode,
    Spinner,
    SpinnerSize,
    Stack,
    type IColumn,
} from "@fluentui/react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { connection } from "../state/connection";
import { i18n } from "../state/i18n";

interface PropRow {
    key: string;
    name: string;
    value: string;
}

const PROPS: [string, string][] = [
    ["ro.product.manufacturer", "Manufacturer"],
    ["ro.product.model", "Model"],
    ["ro.product.brand", "Brand"],
    ["ro.build.version.release", "Android Version"],
    ["ro.build.version.sdk", "SDK"],
    ["ro.build.display.id", "Build"],
    ["ro.serialno", "Serial"],
    ["ro.product.cpu.abi", "CPU ABI"],
    ["ro.build.type", "Build Type"],
    ["ro.debuggable", "Debuggable"],
    ["ro.secure", "Secure"],
    ["ro.product.name", "Product"],
];

export const DeviceInfoPage = observer(function DeviceInfoPage() {
    const t = i18n.t;
    const [rows, setRows] = useState<PropRow[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const adb = connection.adb;
        if (!adb) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const result: PropRow[] = [];
            for (const [prop, label] of PROPS) {
                try {
                    const value = await adb.getProp(prop);
                    result.push({ key: prop, name: label, value: value.trim() });
                } catch {
                    /* skip */
                }
            }
            if (!cancelled) {
                setRows(result);
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [connection.isConnected]);

    const columns: IColumn[] = [
        { key: "name", name: "Property", fieldName: "name", minWidth: 180, maxWidth: 220 },
        { key: "value", name: "Value", fieldName: "value", minWidth: 200 },
    ];

    if (!connection.isConnected) {
        return (
            <Stack styles={{ root: { padding: 16 } }}>
                <MessageBar>{t.waiting}</MessageBar>
            </Stack>
        );
    }

    return (
        <Stack
            styles={{
                root: {
                    padding: 16,
                    gap: 12,
                    height: "100%",
                    minHeight: 0,
                    boxSizing: "border-box",
                    overflowY: "auto",
                    overflowX: "hidden",
                },
            }}
        >
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {t.deviceProperties}
            </h2>
            {loading ? (
                <Spinner size={SpinnerSize.medium} />
            ) : (
                <DetailsList
                    items={rows}
                    columns={columns}
                    selectionMode={SelectionMode.none}
                    layoutMode={DetailsListLayoutMode.justified}
                />
            )}
        </Stack>
    );
});
