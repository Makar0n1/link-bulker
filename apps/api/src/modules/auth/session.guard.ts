import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '@link-checker/shared';
import { AuthService, SESSION_COOKIE_NAME } from './auth.service';

interface FastifyRequestWithCookies extends FastifyRequest {
  cookies: Record<string, string | undefined>;
  unsignCookie(value: string): { valid: boolean; renew: boolean; value: string | null };
  user?: SessionUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequestWithCookies>();
    const raw = req.cookies?.[SESSION_COOKIE_NAME];
    if (!raw) throw new UnauthorizedException('Not authenticated');

    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.authService.getSessionUser(unsigned.value);
    if (!user) throw new UnauthorizedException('Session user not found');

    req.user = user;
    return true;
  }
}
