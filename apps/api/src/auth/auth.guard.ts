import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { memexError, ErrorCode } from '@memex/errors';
import type { Auth } from '@memex/auth';
import { AUTH_TOKEN } from './auth.module';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AUTH_TOKEN) private readonly auth: Auth) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const session = await this.auth.api.getSession({ headers: req.headers as Headers });
    if (!session) {
      throw memexError({
        code: ErrorCode.MEMEX_AUTH_NO_SESSION,
        problem: 'no Better Auth session on request',
        fix: 'Sign in at the dashboard URL.',
      });
    }
    req.user = { id: session.user.id, email: session.user.email };
    return true;
  }
}
