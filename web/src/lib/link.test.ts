import { describe, expect, it } from "vitest"

import { codeFromScan } from "./link"

const ORIGIN = "https://pocketfolio.in"

describe("codeFromScan", () => {
  it("reads the code from our own /link URL", () => {
    expect(codeFromScan("https://pocketfolio.in/link?user_code=ABCD2345", ORIGIN)).toBe("ABCD2345")
  })
  it.each([
    "https://evil.example/link?user_code=ABCD2345",
    "https://pocketfolio.in.evil.example/link?user_code=ABCD2345",
    "http://pocketfolio.in/link?user_code=ABCD2345",
    "https://pocketfolio.in/settings?user_code=ABCD2345",
    "https://pocketfolio.in/link",
    "https://pocketfolio.in/link?user_code=%3Cscript%3E",
    "ABCD2345",
    "",
  ])("ignores %s", (text) => expect(codeFromScan(text, ORIGIN)).toBeNull())
})
