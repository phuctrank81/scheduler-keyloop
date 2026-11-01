import { forward } from '@/lib/proxy';
export const DELETE = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  forward(req, `/api/appointments/${encodeURIComponent((await params).id)}`, 'DELETE');
