import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { MemexError } from '@memex/errors';

const STATUS_MAP: Record<string, number> = {
  MEMEX_AUTH_NO_SESSION: HttpStatus.UNAUTHORIZED,
  MEMEX_OAUTH_EXCHANGE_FAILED: HttpStatus.BAD_REQUEST,
  MEMEX_TOKEN_DECRYPT_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  MEMEX_DB_CONNECTION_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  MEMEX_CONNECTOR_NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,
  MEMEX_ENV_INVALID: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch(MemexError)
export class MemexErrorFilter implements ExceptionFilter {
  catch(err: MemexError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const status = STATUS_MAP[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json(err.toJSON());
  }
}
