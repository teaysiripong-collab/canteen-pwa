/**
 * Google Sheets export configuration.
 *
 * Sheets is a reporting destination in this system, never a source: nothing is ever read back
 * from a spreadsheet into the database. That is why the credential only ever needs write
 * access, and why a failed sync is an inconvenience rather than a data-integrity problem.
 *
 * The private key lives in an environment variable and is never committed. `.env.example`
 * carries the variable names with empty values so the shape is documented without the secret.
 */

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetsCredentials = {
  clientEmail: string;
  /** PEM private key. Stored with literal `\n` in the environment; unescaped on read. */
  privateKey: string;
  spreadsheetId: string;
};

export function sheetsCredentials(): SheetsCredentials | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKey || !spreadsheetId) return null;

  return {
    clientEmail,
    // Environment variables cannot hold real newlines in most hosts, so the key is stored
    // escaped and restored here rather than asking whoever deploys to get it right by hand.
    privateKey: privateKey.replaceAll("\\n", "\n"),
    spreadsheetId,
  };
}

export function isSheetsConfigured(): boolean {
  return sheetsCredentials() !== null;
}
