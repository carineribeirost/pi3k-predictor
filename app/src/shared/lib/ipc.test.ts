import { afterEach, expect, test } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { call } from "./ipc";

afterEach(clearMocks);

// call() logs through the log plugin, which is IPC too.
const isLog = (cmd: string) => cmd.startsWith("plugin:log|");

test("resolves with the command result", async () => {
  mockIPC((cmd) => (cmd === "app_info" ? { version: "0.1.0", logDir: "/tmp" } : null));
  await expect(call("app_info")).resolves.toEqual({ version: "0.1.0", logDir: "/tmp" });
});

test("passes a Rust AppError through unchanged", async () => {
  mockIPC((cmd) => {
    if (isLog(cmd)) return;
    throw { kind: "io", message: "disk full" };
  });
  await expect(call("x")).rejects.toEqual({ kind: "io", message: "disk full" });
});

test("wraps a non-AppError rejection as kind ipc", async () => {
  mockIPC((cmd) => {
    if (isLog(cmd)) return;
    throw "command x not found";
  });
  await expect(call("x")).rejects.toEqual({ kind: "ipc", message: "command x not found" });
});
