import { db } from "./db";
import { getSettings, setSetting } from "./settings";
import type { Shift } from "@prisma/client";

/**
 * Operational configuration the canteen sets for itself — company details on
 * printed paperwork, shift names and times, which days the calendar covers, and
 * document number prefixes.
 *
 * These are read wherever the app used to hard-code a value, so changing them
 * here really changes the app (no redeploy, no code edit).
 */

export const CONFIG_KEYS = {
  ORG_NAME: "org.name",
  ORG_BRANCH: "org.branch",
  ORG_ADDRESS: "org.address",
  ORG_PHONE: "org.phone",
  ORG_TAX_ID: "org.taxId",

  SHIFT_MORNING_LABEL: "shift.morning.label",
  SHIFT_MORNING_TIME: "shift.morning.time",
  SHIFT_NIGHT_LABEL: "shift.night.label",
  SHIFT_NIGHT_TIME: "shift.night.time",
  SHIFT_NIGHT_FACTOR: "shift.night.factor",

  WORKING_DAYS: "calendar.workingDays",

  PO_PREFIX: "doc.poPrefix",
  EMP_PREFIX: "doc.employeePrefix",
} as const;

export type OrgConfig = {
  name: string;
  branch: string;
  address: string;
  phone: string;
  taxId: string;
};

export type ShiftConfig = {
  label: string;
  time: string;
};

export type AppConfig = {
  org: OrgConfig;
  shifts: Record<Shift, ShiftConfig>;
  /** Night-shift default as a fraction of the morning standard BOM (0–1). */
  nightFactor: number;
  /** ISO weekday numbers the menu calendar covers. 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  poPrefix: string;
  employeePrefix: string;
};

export const DEFAULT_CONFIG: AppConfig = {
  org: { name: "แคนทีน", branch: "", address: "", phone: "", taxId: "" },
  shifts: {
    MORNING: { label: "รอบเช้า", time: "06:00-14:00" },
    NIGHT: { label: "รอบดึก", time: "18:00-02:00" },
  },
  nightFactor: 0.6,
  workingDays: [1, 2, 3, 4, 5, 6], // จันทร์–เสาร์
  poPrefix: "PO",
  employeePrefix: "EMP",
};

export async function getConfig(): Promise<AppConfig> {
  const keys = Object.values(CONFIG_KEYS);
  const s = await getSettings(keys as unknown as string[]);
  const or = (v: string, d: string) => (v && v.trim() ? v.trim() : d);

  let workingDays = DEFAULT_CONFIG.workingDays;
  const rawDays = s[CONFIG_KEYS.WORKING_DAYS];
  if (rawDays) {
    const parsed = rawDays
      .split(",")
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (parsed.length > 0) workingDays = [...new Set(parsed)].sort((a, b) => a - b);
  }

  const factor = parseFloat(s[CONFIG_KEYS.SHIFT_NIGHT_FACTOR]);

  return {
    org: {
      name: or(s[CONFIG_KEYS.ORG_NAME], DEFAULT_CONFIG.org.name),
      branch: s[CONFIG_KEYS.ORG_BRANCH] ?? "",
      address: s[CONFIG_KEYS.ORG_ADDRESS] ?? "",
      phone: s[CONFIG_KEYS.ORG_PHONE] ?? "",
      taxId: s[CONFIG_KEYS.ORG_TAX_ID] ?? "",
    },
    shifts: {
      MORNING: {
        label: or(s[CONFIG_KEYS.SHIFT_MORNING_LABEL], DEFAULT_CONFIG.shifts.MORNING.label),
        time: or(s[CONFIG_KEYS.SHIFT_MORNING_TIME], DEFAULT_CONFIG.shifts.MORNING.time),
      },
      NIGHT: {
        label: or(s[CONFIG_KEYS.SHIFT_NIGHT_LABEL], DEFAULT_CONFIG.shifts.NIGHT.label),
        time: or(s[CONFIG_KEYS.SHIFT_NIGHT_TIME], DEFAULT_CONFIG.shifts.NIGHT.time),
      },
    },
    nightFactor: Number.isFinite(factor) && factor > 0 && factor <= 1 ? factor : DEFAULT_CONFIG.nightFactor,
    workingDays,
    poPrefix: or(s[CONFIG_KEYS.PO_PREFIX], DEFAULT_CONFIG.poPrefix),
    employeePrefix: or(s[CONFIG_KEYS.EMP_PREFIX], DEFAULT_CONFIG.employeePrefix),
  };
}

export async function saveConfig(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await setSetting(key, value);
  }
}

export const DAY_NAMES: Record<number, string> = {
  1: "จันทร์", 2: "อังคาร", 3: "พุธ", 4: "พฤหัสบดี", 5: "ศุกร์", 6: "เสาร์", 7: "อาทิตย์",
};

/** ISO weekday (1=Mon..7=Sun) of a UTC date. */
export function isoDay(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

/** The dates of the configured working days, for the week starting at `weekStart`. */
export function workingDatesOf(weekStart: Date, workingDays: number[]): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    if (workingDays.includes(isoDay(d))) out.push(d);
  }
  return out;
}

/** Next employee code, continuing the organisation's own numbering. */
export async function nextEmployeeCode(prefix: string): Promise<string> {
  const users = await db.user.findMany({
    where: { employeeCode: { startsWith: prefix } },
    select: { employeeCode: true },
  });
  let max = 0;
  for (const u of users) {
    const n = parseInt((u.employeeCode ?? "").slice(prefix.length).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
