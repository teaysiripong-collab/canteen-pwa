import {
  GOOGLE_TOKEN_URL,
  SHEETS_API_BASE,
  sheetsCredentials,
  type SheetsCredentials,
} from "./config";
import { signJwt } from "./jwt";

/**
 * The Sheets transport.
 *
 * `SheetsClient` is the seam. The service depends on this interface, never on `fetch`, so the
 * sync can be tested end to end — run recording, error handling, row shaping — without a
 * Google account. Only the HTTP calls in `googleSheetsClient` are unverifiable locally, and
 * they are deliberately the thinnest part of the module.
 */

export type SheetsClient = {
  /** Replaces the whole tab: clears it, then writes header + rows starting at A1. */
  replaceSheet(sheetName: string, values: string[][]): Promise<{ spreadsheetId: string }>;
};

/** Escapes a tab name for an A1 range. Sheet names may contain spaces and Thai characters. */
export function a1Range(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

async function accessToken(credentials: SheetsCredentials): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(credentials, Date.now()),
    }),
  });

  if (!response.ok) {
    // The body carries Google's reason (clock skew, revoked key, wrong scope); without it the
    // operator is left guessing, and it contains no secret of ours.
    throw new Error(`Google token request failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google token response had no access_token");

  return body.access_token;
}

export function googleSheetsClient(credentials: SheetsCredentials): SheetsClient {
  return {
    async replaceSheet(sheetName, values) {
      const token = await accessToken(credentials);
      const authorization = { authorization: `Bearer ${token}` };
      const range = encodeURIComponent(a1Range(sheetName));
      const sheet = `${SHEETS_API_BASE}/${credentials.spreadsheetId}`;

      // Clear first. Writing over a longer previous run without clearing would leave its tail
      // behind, and a stale tail in a report is worse than an empty sheet.
      const cleared = await fetch(`${sheet}/values/${range}:clear`, {
        method: "POST",
        headers: authorization,
      });
      if (!cleared.ok) {
        throw new Error(`Sheets clear failed (${cleared.status}): ${await cleared.text()}`);
      }

      const written = await fetch(
        `${sheet}/values/${range}!A1?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { ...authorization, "content-type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      if (!written.ok) {
        throw new Error(`Sheets write failed (${written.status}): ${await written.text()}`);
      }

      return { spreadsheetId: credentials.spreadsheetId };
    },
  };
}

/** Null when the environment has no credentials, so the caller can say so instead of failing. */
export function defaultSheetsClient(): SheetsClient | null {
  const credentials = sheetsCredentials();
  return credentials ? googleSheetsClient(credentials) : null;
}
