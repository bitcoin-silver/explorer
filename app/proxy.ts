import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'edge'; // wichtig für proxy

export function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname;

  // /api komplett ignorieren
  if (path.startsWith('/api')) return NextResponse.next();

  // /ext/* Weiterleitungen
  if (path.startsWith('/ext/')) {
    const parts = path.split('/');
    let redirectUrl: string | null = null;

    switch (parts[2]) {
      case 'getaddress':
        if (parts[3]) redirectUrl = `/ext/getaddress?address=${parts[3]}`;
        break;
      case 'getbalance':
        if (parts[3]) redirectUrl = `/ext/getbalance?address=${parts[3]}`;
        break;
      case 'gettx':
        if (parts[3]) redirectUrl = `/ext/gettx?txid=${parts[3]}`;
        break;
      case 'getlasttxsajax':
        if (parts[3]) redirectUrl = `/ext/getlasttxsajax?min=${parts[3]}`;
        break;
    }

    if (redirectUrl) {
      /*
      const response = NextResponse.redirect(new URL(redirectUrl, url.origin));
      response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      response.headers.set('CDN-Cache-Control', 'no-store');
      response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
      return response;
      */
      return NextResponse.redirect(new URL(redirectUrl, url.origin), {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        }
      });
    }
  }

  // Alle anderen Routen
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  response.headers.set('CDN-Cache-Control', 'no-store');
  response.headers.set('Vercel-CDN-Cache-Control', 'no-store');
  return response;
}

// Matcher für Proxy/Middleware
export const config = {
  matcher: [
    '/ext/:path*',
    '/((?!_next/static|_next/image|favicon.ico|api).*)',
  ],
};
