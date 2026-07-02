import { fetchInstitutions } from "@/lib/api";

export async function GET() {
  try {
    const institutions = await fetchInstitutions();
    return Response.json(institutions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch institutions";
    return Response.json({ error: message }, { status: 502 });
  }
}
