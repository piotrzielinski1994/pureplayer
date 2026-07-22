import { createTauriViteConfig } from "@pziel/pureui/vite";

export default createTauriViteConfig({
  appUrl: import.meta.url,
  devPort: 1432,
  hmrPort: 1433,
});
