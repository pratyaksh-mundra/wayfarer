import { createServiceClient } from '@wayfarer/core/api/supabase'

// Rate limits per endpoint (requests per window)
const LIMITS: Record<string, { max: number; windowMins: number }> = {
  '/api/generate': { max: 5,  windowMins: 60 },  // 5 full generations per IP per hour
  '/api/update':   { max: 30, windowMins: 60 },  // 30 AI updates per IP per hour
  '/api/create':   { max: 20, windowMins: 60 },  // 20 row creates per IP per hour
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function checkRateLimit(
  ip: string,
  endpoint: string
): Promise<{ allowed: boolean; retryAfterSecs: number }> {
  const limit = LIMITS[endpoint]
  if (!limit) return { allowed: true, retryAfterSecs: 0 }

  const supabase = createServiceClient()
  const windowStart = new Date(Date.now() - limit.windowMins * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('endpoint', endpoint)
    .gte('created_at', windowStart)

  if (error) {
    // On DB error, allow the request — don't block users due to our infra issues
    console.error('Rate limit check failed:', error.message)
    return { allowed: true, retryAfterSecs: 0 }
  }

  if ((count ?? 0) >= limit.max) {
    return { allowed: false, retryAfterSecs: limit.windowMins * 60 }
  }

  // Record this request (fire-and-forget, don't await)
  void supabase.from('rate_limits').insert({ ip, endpoint })

  // Probabilistic cleanup of old records (1% chance per request)
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    void supabase.from('rate_limits').delete().lt('created_at', cutoff)
  }

  return { allowed: true, retryAfterSecs: 0 }
}

export function rateLimitResponse(retryAfterSecs: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please wait before trying again.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSecs),
      },
    }
  )
}
