import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { LucideIcon } from "lucide-react";

type SectionHeaderProps = {
  title: string;
  description?: string;
  icon: LucideIcon;
  actionIcon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({
  title,
  description,
  icon: Icon,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
}: SectionHeaderProps) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
      <Stack direction="row" alignItems="center" gap={1.25} minWidth={0}>
        <Box color="primary.main" display="grid" sx={{ placeItems: "center" }}>
          <Icon size={20} />
        </Box>
        <Box minWidth={0}>
          <Typography variant="h3" noWrap>
            {title}
          </Typography>
          {description ? (
            <Typography color="text.secondary" fontSize={12} noWrap>
              {description}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {ActionIcon && actionLabel ? (
        <Tooltip title={actionLabel}>
          <IconButton size="small" onClick={onAction} aria-label={actionLabel}>
            <ActionIcon size={17} />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}
