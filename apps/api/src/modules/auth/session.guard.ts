import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { SessionUser } from '@link-checker/shared';
import { AuthService, SESSION_COOKIE_NAME } from './auth.service';

// We don't extend FastifyRequest because @fastify/cookie's UnsignResult is
// a discriminated union (`{valid: true; ...} | {valid: false; ...}`) and
// extending FastifyRequest with a wider signature breaks TS variance rules.
// A loose shape is enough: this is only used inside the guard.
interface RequestShape {
  cookies?: Record<string, string | undefined>;
  unsignCookie(value: string): { valid: boolean; value: string | null };
  user?: SessionUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestShape>();
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
