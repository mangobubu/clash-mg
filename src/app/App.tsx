import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "../layout/AppShell";
import { queryClient } from "./queryClient";
import { createAppTheme } from "./theme";
import { useUiStore } from "../shared/store/uiStore";

function App() {
  const themeMode = useUiStore((state) => state.themeMode);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme(themeMode)}>
        <CssBaseline />
        <AppShell />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
