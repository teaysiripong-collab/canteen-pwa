import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { a1Range } from "../client";
import { isSheetsConfigured, sheetsCredentials } from "../config";

const KEYS = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("sheetsCredentials", () => {
  it("is absent until all three variables are set", () => {
    expect(isSheetsConfigured()).toBe(false);

    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "export@example.iam.gserviceaccount.com";
    process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
    expect(isSheetsConfigured()).toBe(false);

    process.env.GOOGLE_SHEET_ID = "sheet-123";
    expect(isSheetsConfigured()).toBe(true);
  });

  it("restores the newlines an environment variable cannot carry", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "export@example.iam.gserviceaccount.com";
    process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
    process.env.GOOGLE_SHEET_ID = "sheet-123";

    // Without this the PEM parser rejects the key and the error names neither cause nor fix.
    expect(sheetsCredentials()!.privateKey).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
  });
});

describe("a1Range", () => {
  it("quotes a tab name so a space cannot break the range", () => {
    expect(a1Range("Stock On Hand")).toBe("'Stock On Hand'");
  });

  it("doubles an apostrophe inside a tab name", () => {
    expect(a1Range("Bob's Sheet")).toBe("'Bob''s Sheet'");
  });
});
