import { Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { FileCode2, FolderOpen, Link, RefreshCw } from "lucide-react";
import { useActivateProfile, useImportProfile, useProfiles } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";
import { StatusPill } from "../../shared/components/StatusPill";

export function ProfilesPage() {
  const profiles = useProfiles();
  const activateProfile = useActivateProfile();
  const importProfile = useImportProfile();

  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", lg: "minmax(0, 7fr) minmax(320px, 5fr)" }} gap={2}>
      <Box>
        <Card>
          <CardContent>
            <SectionHeader title="配置文件" icon={FileCode2} actionIcon={RefreshCw} actionLabel="更新订阅" />
            <Stack spacing={1.25} mt={2}>
              {(profiles.data ?? []).map((profile) => (
                <Stack
                  key={profile.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  gap={2}
                  border={1}
                  borderColor={profile.active ? "primary.main" : "divider"}
                  borderRadius={2}
                  p={1.5}
                >
                  <Stack minWidth={0}>
                    <Typography fontWeight={900} noWrap>
                      {profile.name}
                    </Typography>
                    <Typography color="text.secondary" fontSize={12}>
                      {profile.updated_at} · {profile.rule_count} 条规则 · {profile.source}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {profile.active ? <StatusPill label="已启用" tone="success" /> : null}
                    <Button
                      variant={profile.active ? "outlined" : "contained"}
                      onClick={() => activateProfile.mutate(profile.id)}
                      disabled={profile.active}
                    >
                      启用
                    </Button>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <Box>
        <Card>
          <CardContent>
            <SectionHeader title="导入配置" icon={FolderOpen} />
            <Stack spacing={1.5} mt={2}>
              <TextField label="配置名称" size="small" defaultValue="新订阅" />
              <TextField label="订阅 URL" size="small" placeholder="https://example.com/sub.yaml" />
              <Button
                variant="contained"
                startIcon={<Link size={16} />}
                onClick={() =>
                  importProfile.mutate({
                    name: "新订阅",
                    source: "remote",
                    url: "https://example.com/sub.yaml",
                  })
                }
              >
                导入订阅
              </Button>
              <Button variant="outlined" startIcon={<FolderOpen size={16} />}>
                选择本地 YAML
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
