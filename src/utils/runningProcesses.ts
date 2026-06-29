import type { Connection, RuleType, RunningProcess } from "../types";

export interface RunningProcessOption {
  label: string;
  value: string;
}

export function getRunningProcessOptions(
  runningProcesses: RunningProcess[],
  connections: Connection[],
  ruleType: RuleType | undefined,
): RunningProcessOption[] {
  const options = new Map<string, string>();
  const addOption = (name: string, path: string) => {
    const cleanName = name.trim();
    const cleanPath = path.trim();
    if (
      !cleanName ||
      cleanName === "内核未识别" ||
      cleanName.startsWith("前置代理：")
    ) return;

    const value = ruleType === "PROCESS-PATH" ? cleanPath : cleanName;
    if (!value) return;
    const label = cleanPath ? `${cleanName} - ${cleanPath}` : cleanName;
    if (!options.has(value)) options.set(value, label);
  };

  runningProcesses.forEach((process) => addOption(process.name, process.path));
  connections.forEach((connection) =>
    addOption(connection.process, connection.processPath),
  );

  return Array.from(options, ([value, label]) => ({ label, value })).sort(
    (current, next) => current.value.localeCompare(next.value),
  );
}
