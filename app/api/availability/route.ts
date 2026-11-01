import { forward } from '@/lib/proxy';
export const POST = (req: Request) => forward(req, '/api/availability', 'POST');
