import { describe, expect, it } from "vitest";
import { parseAllowedClientOrigins } from "./origins.js";

describe("parseAllowedClientOrigins", () => {
  it("accepts an explicit loopback web origin", () => {
    expect(
      parseAllowedClientOrigins(undefined, "http://127.0.0.1:4173"),
    ).toEqual(["http://127.0.0.1:4173"]);
  });

  it("combines extension and web origins without duplicates", () => {
    const extension = `chrome-extension://${"a".repeat(32)}`;
    expect(
      parseAllowedClientOrigins(
        extension,
        "http://localhost:4173,http://localhost:4173",
      ),
    ).toEqual([extension, "http://localhost:4173"]);
  });

  it.each([
    "https://threadflow.example.com",
    "http://127.0.0.1:4173/path",
    "http://127.0.0.1:4173?key=value",
  ])("rejects a non-exact loopback web origin: %s", (origin) => {
    expect(() => parseAllowedClientOrigins(undefined, origin)).toThrow(
      "THREADFLOW_WEB_ORIGINS",
    );
  });

  it("requires at least one configured client origin", () => {
    expect(() => parseAllowedClientOrigins(undefined, undefined)).toThrow(
      "Configure THREADFLOW_WEB_ORIGINS",
    );
  });
});
