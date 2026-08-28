import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GOOGLE_TOKEN_URL, SHEETS_SCOPE, type SheetsCredentials } from "../config";
import { buildJwtClaims, decodeJwtClaims, signJwt, TOKEN_LIFETIME_SECONDS } from "../jwt";

/**
 * Google rejects a malformed assertion with a message that says almost nothing, so the claim
 * set is worth pinning down here rather than discovering by trial against a live account.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const credentials: SheetsCredentials = {
  clientEmail: "canteen-export@example.iam.gserviceaccount.com",
  privateKey,
  spreadsheetId: "sheet-123",
};

const NOW = Date.parse("2026-08-14T03:00:00Z");

describe("buildJwtClaims", () => {
  it("asks only for the Sheets scope", () => {
    // A broader scope would let a leaked key reach Drive and Gmail as well.
    expect(buildJwtClaims(credentials.clientEmail, NOW).scope).toBe(SHEETS_SCOPE);
  });

  it("addresses the token endpoint, not the Sheets API", () => {
    expect(buildJwtClaims(credentials.clientEmail, NOW).aud).toBe(GOOGLE_TOKEN_URL);
  });

  it("expires well inside Google's one hour limit", () => {
    const claims = buildJwtClaims(credentials.clientEmail, NOW);

    expect(claims.exp - claims.iat).toBe(TOKEN_LIFETIME_SECONDS);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
  });

  it("uses seconds, not milliseconds", () => {
    // A millisecond timestamp is accepted as a number and then read as the year 57000.
    expect(buildJwtClaims(credentials.clientEmail, NOW).iat).toBe(Math.floor(NOW / 1000));
  });
});

describe("signJwt", () => {
  it("produces three base64url segments with no padding", () => {
    const token = signJwt(credentials, NOW);
    const segments = token.split(".");

    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).not.toContain("=");
      expect(segment).not.toContain("+");
      expect(segment).not.toContain("/");
    }
  });

  it("round-trips the claims it signed", () => {
    expect(decodeJwtClaims(signJwt(credentials, NOW))).toEqual(
      buildJwtClaims(credentials.clientEmail, NOW),
    );
  });

  it("declares RS256, the only algorithm Google accepts here", () => {
    const header = JSON.parse(
      Buffer.from(signJwt(credentials, NOW).split(".")[0]!, "base64url").toString("utf8"),
    );

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });
});
