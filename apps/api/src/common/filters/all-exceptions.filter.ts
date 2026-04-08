import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    let body: ErrorBody;

    if (exception instanceof ZodError) {
      body = {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'ValidationError',
        message: 'Request validation failed',
        details: exception.flatten(),
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        body = {
          statusCode: status,
          error: HttpStatus[status] ?? 'Error',
          message: response,
        };
      } else {
        // Merge any extra fields from the object response (e.g. retryAfterSec
        // on a 429) into the top-level body so clients can read them directly.
        body = {
          statusCode: status,
          error: HttpStatus[status] ?? 'Error',
          message: (response as any)?.message ?? exception.message,
          ...(response as object),
        };
      }
    } else {
      const err = exception as Error;
      // eslint-disable-next-line no-console
      console.error('[AllExceptionsFilter] Unhandled exception:', err?.message, err?.stack);
      this.logger.error('Unhandled exception', err as any);
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'InternalServerError',
        message: 'Something went wrong',
        ...(process.env.NODE_ENV !== 'production'
          ? { _debug: err?.message ?? String(err) }
          : {}),
      } as ErrorBody;
    }

    // log non-2xx for visibility
    if (body.statusCode >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[AllExceptionsFilter] ${req.method} ${req.url} -> ${body.statusCode}`);
    }

    res.status(body.statusCode).send(body);
  }
}
