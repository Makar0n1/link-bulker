import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '@link-checker/shared';

export const CurrentUser = createParamDecorator<unknown, ExecutionContext, SessionUser>(
  (_data, ctx) => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: SessionUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without SessionGuard');
    }
    return req.user;
  },
);
