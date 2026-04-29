import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { HoloError } from '@holo/errors';

const STATUS_MAP: Record<string, number> = {
  HOLO_AUTH_NO_SESSION: HttpStatus.UNAUTHORIZED,
  HOLO_OAUTH_EXCHANGE_FAILED: HttpStatus.BAD_REQUEST,
  HOLO_TOKEN_DECRYPT_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  HOLO_DB_CONNECTION_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  HOLO_CONNECTOR_NOT_IMPLEMENTED: HttpStatus.NOT_IMPLEMENTED,
  HOLO_ENV_INVALID: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch(HoloError)
export class HoloErrorFilter implements ExceptionFilter {
  catch(err: HoloError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const status = STATUS_MAP[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json(err.toJSON());
  }
}
