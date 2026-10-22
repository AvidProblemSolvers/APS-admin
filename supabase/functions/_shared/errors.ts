export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/** A PostgREST / Postgres error. `code` is the SQLSTATE where there is one. */
export class DbError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const bad = (code: string, message?: string) => new HttpError(400, code, message);
export const notFound = (what = "not_found") => new HttpError(404, what);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
