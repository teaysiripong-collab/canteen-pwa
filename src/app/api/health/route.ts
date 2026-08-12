import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/database/client";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe used by the deployment platform and the Phase 0 gate.
 * It reports the process as healthy only when the database actually answers a query,
 * because every workflow in this system is a database transaction.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await db.execute(sql`select 1`);

    return NextResponse.json(
      {
        status: "ok",
        database: "up",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    // The reason stays in the server log; the response never leaks connection details.
    console.error("[health] database check failed", error);

    return NextResponse.json(
      {
        status: "error",
        database: "down",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
