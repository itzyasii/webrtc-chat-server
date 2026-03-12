export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(
    code: string,
    statusCode: number,
    message?: string,
    details?: unknown,
  ) {
    super(message ?? code);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
