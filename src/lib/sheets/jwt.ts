import { createSign } from "node:crypto";
import { GOOGLE_TOKEN_URL, SHEETS_SCOPE, type SheetsCredentials } from "./config";

/**
 * Service-account authentication for the Sheets API.
 *
 * Google's flow is: sign a short-lived JWT with the service account's private key, exchange it
 * for an access token, use the token. Written by hand rather than pulling in `googleapis` —
 * that package is large, and this is one signature and one POST.
 *
 * The claim set is built here so it can be asserted on in tests without any network: an
 * expiry that is too long, or a wrong audience, fails silently at Google with a message that
 * says nothing useful, so it is worth pinning down locally.
 */

export type JwtClaims = {
  iss: string;
  scope: string;
  aud: string;
  exp: number;
  iat: number;
};

/** Google rejects anything over an hour; ten minutes is plenty for one export. */
export const TOKEN_LIFETIME_SECONDS = 600;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function buildJwtClaims(clientEmail: string, nowMs: number): JwtClaims {
  const issuedAt = Math.floor(nowMs / 1000);

  return {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };
}

export function signJwt(credentials: SheetsCredentials, nowMs: number): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(buildJwtClaims(credentials.clientEmail, nowMs)));
  const signingInput = `${header}.${payload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${base64Url(signer.sign(credentials.privateKey))}`;
}

/** Decodes a signed JWT's claim segment. Used by tests and by nothing in the request path. */
export function decodeJwtClaims(token: string): JwtClaims {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtClaims;
}
