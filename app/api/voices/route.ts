import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Voice = { voice_id: string; name: string };

function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || 'unknown';
  const xr = req.headers.get('x-real-ip');
  if (xr) return xr.trim();
  return 'unknown';
}

function getRatelimiter() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'), // 30 req/min/IP
    analytics: true,
    prefix: 'vaanilink:rl:voices',
  });
}

export async function GET(req: Request) {
  try {
    const rl = getRatelimiter();
    if (rl) {
      const ip = getClientIp(req);
      const { success, reset } = await rl.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: { detail: { message: 'Rate limit exceeded. Try again shortly.' }, reset } },
          { status: 429 }
        );
      }
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: { detail: { message: 'ElevenLabs API key not configured' } } }, { status: 500 });
    }

    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      // Common case on free/limited keys: missing voices_read permission.
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore
      }
      const status = json?.detail?.status ?? '';
      if (res.status === 401 && status === 'missing_permissions') {
        return NextResponse.json({
          voices: [],
          warning: {
            code: 'missing_voices_read',
            message:
              'Your ElevenLabs API key cannot list voices (missing voices_read permission). Default voice will still work.',
          },
        });
      }

      const text = json ?? (await res.text().catch(() => ''));
      return NextResponse.json(
        { error: { detail: { message: `Failed to list voices (status ${res.status}) ${JSON.stringify(text)}` } } },
        { status: res.status }
      );
    }

    const data = (await res.json()) as { voices?: Array<{ voice_id?: string; name?: string }> };
    const voices: Voice[] =
      data.voices
        ?.filter((v): v is { voice_id: string; name: string } => typeof v.voice_id === 'string' && typeof v.name === 'string')
        .map((v) => ({ voice_id: v.voice_id, name: v.name })) ?? [];

    return NextResponse.json({ voices });
  } catch (e) {
    console.error('Voices API error:', e);
    return NextResponse.json({ error: { detail: { message: 'Internal Server Error' } } }, { status: 500 });
  }
}

