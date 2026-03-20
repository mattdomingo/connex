import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { AuthProvider } from "./hooks/useAuth.js";
import { ThemeProvider } from "./hooks/useTheme.js";
import { SyncStatusProvider } from "./hooks/useSyncStatus.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SyncStatusProvider>
            <App />
          </SyncStatusProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
