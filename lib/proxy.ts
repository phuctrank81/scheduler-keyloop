// Server-side helper used by the Next.js Route Handlers (BFF): validates nothing about
// business rules, just forwards to the mock backend with the tracing headers attached.
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3101';
const TRACE_HEADERS = ['x-correlation-id', 'idempotency-key'] as const;

export async function forward(req: Request, path: string, method: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  for (const header of TRACE_HEADERS) {
    const value = req.headers.get(header);
    if (value) headers[header] = value;
  }

  try {
    const body = method === 'GET' || method === 'DELETE' ? undefined : await req.text();
    const upstream = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return Response.json({ code: 'BACKEND_UNAVAILABLE' }, { status: 502 });
  }
}
