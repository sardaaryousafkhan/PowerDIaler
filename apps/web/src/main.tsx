import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { DialerApp } from "./DialerApp.js";
import { AuthProvider } from "./authContext.js";
import { applyThemeMode, readThemeMode } from "./theme.js";
import "./design/tokens.css";
import "./design/base.css";
import "./design/components.css";
import "./design/shell.css";
import "./design/art-direction.css";
import "./design/honesty-shell.css";

try {
  applyThemeMode(readThemeMode());
} catch {
  applyThemeMode("dark");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialerApp />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
