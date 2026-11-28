import { makeAutoObservable, runInAction } from "mobx";

export type Route =
    | "readme"
    | "device-info"
    | "file-manager"
    | "screen-capture"
    | "terminal"
    | "mirror"
    | "logcat"
    | "install"
    | "privilege"
    | "power"
    | "wifi-adb"
    | "test-script"
    | "commands";

const VALID: Route[] = [
    "readme",
    "device-info",
    "file-manager",
    "screen-capture",
    "terminal",
    "mirror",
    "logcat",
    "install",
    "privilege",
    "power",
    "wifi-adb",
    "test-script",
    "commands",
];

function readHash(): Route {
    const hash = window.location.hash.replace(/^#\/?/, "");
    return (VALID.includes(hash as Route) ? hash : "readme") as Route;
}

class RouterStore {
    route: Route = "readme";

    constructor() {
        makeAutoObservable(this);
        if (typeof window !== "undefined") {
            this.route = readHash();
            window.addEventListener("hashchange", () => {
                runInAction(() => {
                    this.route = readHash();
                });
            });
        }
    }

    navigate(route: Route) {
        if (typeof window !== "undefined") {
            window.location.hash = `/${route}`;
        }
        runInAction(() => {
            this.route = route;
        });
    }
}

export const router = new RouterStore();

export function useRoute(): Route {
    return router.route;
}
