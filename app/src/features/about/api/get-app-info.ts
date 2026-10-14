import type { AppInfo } from "../../../bindings/AppInfo";
import { call } from "../../../shared/lib/ipc";

export const getAppInfo = () => call<AppInfo>("app_info");
