import { describe, expect, it } from "vitest";
import type { Connection, RunningProcess } from "../types";
import { getRunningProcessOptions } from "./runningProcesses";

const runningProcesses: RunningProcess[] = [
  { name: "chrome.exe", path: "C:\\Apps\\chrome.exe" },
  { name: "helper.exe", path: "" },
];

const connection = (process: string, processPath: string) =>
  ({ process, processPath }) as Connection;

describe("运行进程规则候选项", () => {
  it("按名称合并系统进程与连接记录并去重", () => {
    expect(
      getRunningProcessOptions(
        runningProcesses,
        [
          connection("chrome.exe", "C:\\Apps\\chrome.exe"),
          connection("telegram.exe", "C:\\Apps\\telegram.exe"),
          connection("内核未识别", ""),
        ],
        "PROCESS-NAME",
      ),
    ).toEqual([
      {
        label: "chrome.exe - C:\\Apps\\chrome.exe",
        value: "chrome.exe",
      },
      { label: "helper.exe", value: "helper.exe" },
      {
        label: "telegram.exe - C:\\Apps\\telegram.exe",
        value: "telegram.exe",
      },
    ]);
  });

  it("按路径时忽略无法读取可执行路径的进程", () => {
    expect(
      getRunningProcessOptions(
        runningProcesses,
        [connection("telegram.exe", "C:\\Apps\\telegram.exe")],
        "PROCESS-PATH",
      ).map((option) => option.value),
    ).toEqual(["C:\\Apps\\chrome.exe", "C:\\Apps\\telegram.exe"]);
  });
});
