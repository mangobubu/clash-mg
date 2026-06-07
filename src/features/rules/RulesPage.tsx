import { Box, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { ListFilter, Route } from "lucide-react";
import { SectionHeader } from "../../shared/components/SectionHeader";
import { StatusPill } from "../../shared/components/StatusPill";

const rules = [
  { label: "OpenAI", route: "AI", count: 28 },
  { label: "Netflix", route: "Streaming", count: 142 },
  { label: "Apple", route: "DIRECT", count: 96 },
  { label: "Steam", route: "Proxy", count: 64 },
  { label: "Microsoft", route: "DIRECT", count: 74 },
  { label: "Telegram", route: "Proxy", count: 38 },
];

export function RulesPage() {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
          <SectionHeader title="规则命中" icon={Route} actionIcon={ListFilter} actionLabel="筛选规则" />
          <TextField size="small" placeholder="搜索规则" sx={{ width: 260 }} />
        </Stack>
        <Box display="grid" gridTemplateColumns={{ xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }} gap={1.25} mt={1}>
          {rules.map((rule) => (
            <Box key={rule.label}>
              <Stack border={1} borderColor="divider" borderRadius={2} p={1.5} spacing={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={900}>{rule.label}</Typography>
                  <StatusPill label={rule.route} />
                </Stack>
                <Typography color="text.secondary" fontSize={12}>
                  {rule.count} 条规则匹配当前策略
                </Typography>
              </Stack>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
