import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };
export type Download = { done: number; total: number | null };

/** The newer signed release on GitHub, or null when this version is current. */
export const checkForUpdate = () => check();

/** Downloads and installs the update, then restarts the app into it. */
export async function installAndRestart(update: Update, onProgress: (d: Download) => void) {
  let done = 0;
  let total: number | null = null;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    if (e.event === "Progress") done += e.data.chunkLength;
    onProgress({ done, total });
  });
  await relaunch();
}
