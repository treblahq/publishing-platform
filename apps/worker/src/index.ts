import { parseWorkerBindings } from './bindings.js';

export default {
  fetch(_request: Request, environment: Record<string, unknown>): Response {
    parseWorkerBindings(environment);
    return Response.json({ status: 'ok' });
  },
};
