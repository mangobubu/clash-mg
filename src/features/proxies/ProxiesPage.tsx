import {
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { Check, Network, RefreshCw } from "lucide-react";
import { useProxyGroups, useSelectProxy } from "../../shared/api/queries";
import { SectionHeader } from "../../shared/components/SectionHeader";

export function ProxiesPage() {
  const groups = useProxyGroups();
  const selectProxy = useSelectProxy();

  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap={2}>
      {(groups.data ?? []).map((group) => (
        <Box key={group.name}>
          <Card>
            <CardContent>
              <SectionHeader
                title={group.name}
                description={`${group.type} · 当前 ${group.selected}`}
                icon={Network}
                actionIcon={RefreshCw}
                actionLabel="测试延迟"
              />
              <Stack spacing={1.25} mt={2}>
                {group.proxies.map((proxy) => {
                  const active = proxy.name === group.selected;
                  return (
                    <Button
                      key={proxy.name}
                      variant={active ? "contained" : "outlined"}
                      color={proxy.alive ? "primary" : "warning"}
                      onClick={() => selectProxy.mutate({ group: group.name, proxy: proxy.name })}
                      sx={{
                        justifyContent: "stretch",
                        minHeight: 52,
                        px: 1.5,
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1.5} width="100%">
                        <Box
                          width={38}
                          height={28}
                          borderRadius={1.5}
                          display="grid"
                          sx={{ placeItems: "center" }}
                          bgcolor={active ? "rgba(255,255,255,0.18)" : "action.hover"}
                          fontWeight={900}
                        >
                          {proxy.name.slice(0, 2)}
                        </Box>
                        <Box flex={1} minWidth={0} textAlign="left">
                          <Typography fontWeight={900} noWrap>
                            {proxy.name}
                          </Typography>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(100, proxy.delay)}
                            sx={{ mt: 0.75, height: 5, borderRadius: 999 }}
                          />
                        </Box>
                        <Typography fontWeight={900}>{proxy.delay} ms</Typography>
                        {active ? <Check size={18} /> : null}
                      </Stack>
                    </Button>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Box>
      ))}
    </Box>
  );
}
