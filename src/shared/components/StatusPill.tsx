import { Chip } from "@mui/material";

type StatusPillProps = {
  label: string;
  tone?: "success" | "warning" | "error" | "default";
};

export function StatusPill({ label, tone = "default" }: StatusPillProps) {
  return (
    <Chip
      label={label}
      size="small"
      color={tone === "default" ? undefined : tone}
      variant={tone === "default" ? "outlined" : "filled"}
      sx={{ borderRadius: 999, fontWeight: 800, minWidth: 72 }}
    />
  );
}
