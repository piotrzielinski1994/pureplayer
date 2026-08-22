import { createVitestConfig } from "@pziel/pureui/vitest";

export default createVitestConfig({
  appUrl: import.meta.url,
  include: [
    "src/**/*.test.{ts,tsx}",
    "tests/**/*.{test,spec}.{ts,tsx}",
  ],
});
