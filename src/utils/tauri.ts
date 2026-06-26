export async function isTauriRuntime() {
  if (Boolean((globalThis as { isTauri?: boolean }).isTauri)) return true;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return true;

  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return isTauri();
  } catch {
    return false;
  }
}
