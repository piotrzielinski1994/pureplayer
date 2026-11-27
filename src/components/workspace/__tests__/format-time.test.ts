import { describe, expect, it } from "vitest";

import { formatTime } from "@/components/workspace/format-time";

describe("formatTime", () => {
  // behavior: a value under 1 h keeps the mm:ss form
  it("should format as mm:ss if the value is under 1 h", () => {
    expect(formatTime(75)).toBe("01:15");
  });

  // behavior: a zero value still shows two-digit hours when the reference is 1 h or more
  it("should format hours as 00 if the value is 0 with a long reference", () => {
    expect(formatTime(0, 4512)).toBe("00:00:00");
  });

  // behavior: a value of 1 h or more shows zero-padded hours (F4)
  it("should format as hh:mm:ss if the value is 1 h or more", () => {
    expect(formatTime(4512)).toBe("01:15:12");
  });

  // behavior: a short value is shown in the same hh:mm:ss form as a long reference (F4)
  it("should format as hh:mm:ss if the reference is 1 h or more", () => {
    expect(formatTime(30, 3600)).toBe("00:00:30");
  });
});
