import { initDb, sql } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing session id" }, { status: 400 });
  }

  await initDb();
  const { rows } = await sql`SELECT * FROM sessions WHERE id = ${id}`;

  if (rows.length === 0) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json(rows[0]);
}

export async function POST(req: Request) {
  const { id, institutionId, messages } = await req.json();

  if (!id || !institutionId) {
    return Response.json(
      { error: "Missing required fields: id, institutionId" },
      { status: 400 }
    );
  }

  await initDb();

  const { rows } = await sql`
    INSERT INTO sessions (id, institution_id, messages)
    VALUES (${id}, ${institutionId}, ${JSON.stringify(messages ?? [])}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      messages = ${JSON.stringify(messages ?? [])}::jsonb,
      updated_at = NOW()
    RETURNING *;
  `;

  return Response.json(rows[0]);
}
