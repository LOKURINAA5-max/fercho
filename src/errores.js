export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const bad = (m) => new HttpError(400, m);
