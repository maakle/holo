export type CodeChallengeMethod = 'S256';

export interface AuthCodeRecord {
  code: string;
  clientId: string;
  userId: string;
  organizationId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  expiresAt: Date;
}

export interface AccessTokenRecord {
  /** raw access token string returned to the client */
  accessToken: string;
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
  expiresAt: Date;
}
