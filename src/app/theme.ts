import { createTheme, type PaletteMode } from "@mui/material";

export function createAppTheme(mode: PaletteMode) {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#0f6b5f",
        light: "#2f8d7f",
        dark: "#08483f",
      },
      secondary: {
        main: "#d58b26",
      },
      success: {
        main: "#18a66f",
      },
      warning: {
        main: "#d58b26",
      },
      error: {
        main: "#d24b40",
      },
      background: {
        default: isDark ? "#10161d" : "#f4f7f9",
        paper: isDark ? "#151d26" : "#ffffff",
      },
      text: {
        primary: isDark ? "#edf3f6" : "#17212b",
        secondary: isDark ? "#9fb0bd" : "#60717f",
      },
      divider: isDark ? "#263440" : "#dce4eb",
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily:
        'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      h1: {
        fontSize: 26,
        fontWeight: 800,
      },
      h2: {
        fontSize: 20,
        fontWeight: 800,
      },
      h3: {
        fontSize: 16,
        fontWeight: 800,
      },
      button: {
        fontWeight: 700,
        textTransform: "none",
      },
    },
    components: {
      MuiButton: {
        defaultProps: {
          size: "small",
        },
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            border: `1px solid ${isDark ? "#263440" : "#dce4eb"}`,
            boxShadow: "none",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
      MuiTooltip: {
        defaultProps: {
          arrow: true,
        },
      },
    },
  });
}
