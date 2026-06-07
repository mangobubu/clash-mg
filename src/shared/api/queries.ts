import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./tauri";
import type { AppSettingsPatch, ProfileImportInput } from "../types/domain";

export function useAppStatus() {
  return useQuery({
    queryKey: ["app-status"],
    queryFn: api.getAppStatus,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });
}

export function useProxyGroups() {
  return useQuery({
    queryKey: ["proxy-groups"],
    queryFn: api.listProxyGroups,
  });
}

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });
}

export function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: api.listLogs,
  });
}

export function useCoreActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["app-status"] });

  return {
    start: useMutation({ mutationFn: api.startCore, onSuccess: refresh }),
    stop: useMutation({ mutationFn: api.stopCore, onSuccess: refresh }),
    restart: useMutation({ mutationFn: api.restartCore, onSuccess: refresh }),
  };
}

export function useActivateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.activateProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["app-status"] });
      queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
  });
}

export function useImportProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProfileImportInput) => api.importProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

export function useSelectProxy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ group, proxy }: { group: string; proxy: string }) =>
      api.selectProxy(group, proxy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proxy-groups"] }),
  });
}

export function useCloseConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.closeConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api.updateSettings(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["app-status"] });
    },
  });
}
