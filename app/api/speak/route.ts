import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type SpeakBody = {
  text?: string;
  voiceId?: string;
  modelId?: string;
};

const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (commonly available built-in voice)
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

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
    limiter: Ratelimit.slidingWindow(20, '1 m'), // 20 TTS/min/IP
    analytics: true,
    prefix: 'vaanilink:rl:speak',
  });
}

async function resolveVoiceId(apiKey: string, preferredVoiceId?: string) {
  if (preferredVoiceId) return preferredVoiceId;

  const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: {
      'xi-api-key': apiKey,
      accept: 'application/json',
    },
  });

  if (!voicesRes.ok) {
    // Some API keys don't have voices_read; fall back to a known voice ID.
    if (voicesRes.status === 401) return FALLBACK_VOICE_ID;
    throw new Error(`Failed to list voices (status ${voicesRes.status})`);
  }

  const voicesData = (await voicesRes.json()) as { voices?: Array<{ voice_id?: string }> };
  const firstVoiceId = voicesData.voices?.find(v => typeof v.voice_id === 'string')?.voice_id;

  if (!firstVoiceId) {
    throw new Error('No voices found on this ElevenLabs account');
  }

  return firstVoiceId;
}

export async function POST(req: Request) {
  try {
    const rl = getRatelimiter();
    if (rl) {
      const ip = getClientIp(req);
      const { success, reset } = await rl.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: { detail: { message: 'Rate limit exceeded. Please slow down.' }, reset } },
          { status: 429 }
        );
      }
    }

    const body = (await req.json()) as SpeakBody;
    const text = body.text?.trim();
    
    // 1. Get the API Key safely from the server's environment
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const preferredVoiceId = body.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    const modelId = body.modelId ?? DEFAULT_MODEL_ID;

    if (!ELEVENLABS_API_KEY) {
      console.error("Missing ElevenLabs API Key in Environment Variables");
      return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
    }

    if (!text) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    const voiceId = await resolveVoiceId(ELEVENLABS_API_KEY, preferredVoiceId);

    // 2. Call ElevenLabs API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
        }),
      }
    );

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const errorData = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      return NextResponse.json({ error: errorData }, { status: response.status });
    }

    // 3. Stream the audio back to the frontend
    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    });

  } catch (error) {
    console.error("Speech Generation Error:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}