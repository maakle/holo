import { NextResponse } from 'next/server';

// Microsoft Entra ID publisher domain verification for the Holo Teams app.
// Served at /.well-known/microsoft-identity-association.json via the
// next.config.mjs rewrite. The applicationId is the Azure AD app
// registration's "Application (client) ID" — public, safe to commit.
export function GET() {
  return NextResponse.json({
    associatedApplications: [
      { applicationId: 'a5d0e15e-34ee-4544-8e67-464b37079c0a' },
    ],
  });
}
