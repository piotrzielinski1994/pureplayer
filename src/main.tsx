import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "@/app/providers";
import { log } from "@/lib/logging/log";
import { startFileDropSubscription } from "@/lib/tauri";
import { router } from "@/router";
import "@/index.css";

// Before React mounts: the webview discards a drop when no JS listener exists, and
// the Workspace (which attaches the real handler) only renders after the async
// settings load - so a file dropped while the app is still booting used to vanish.
log.info("app: frontend boot");
startFileDropSubscription();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>,
);
