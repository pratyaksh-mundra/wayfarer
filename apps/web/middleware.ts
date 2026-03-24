import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY')
  // Prevent MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')
  // XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block')
  // Control referrer info
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Restrict browser features
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')
  // HTTPS only (Vercel handles this, but belt-and-suspenders)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  }

  return response
}

export const config = {
  // Apply to all routes except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
