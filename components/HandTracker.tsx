'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { Camera, CircleStop, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type Landmark = { x: number; y: number; z?: number };
type Landmarks = Landmark[];

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

type SpeakErrorBody =
  | { error?: { detail?: { message?: string } } }
  | { detail?: { message?: string } }
  | null;

function extractSpeakErrorMessage(body: SpeakErrorBody): string | null {
  if (!body) return null;

  if ('error' in body) {
    const msg = body.error?.detail?.message;
    return typeof msg === 'string' ? msg : null;
  }

  if ('detail' in body) {
    const msg = body.detail?.message;
    return typeof msg === 'string' ? msg : null;
  }

  return null;
}

type GestureId =
  | 'hello'
  | 'yes'
  | 'good_okay'
  | 'no'
  | 'wait'
  | 'help'
  | 'assistance'
  | 'thank_you'
  | 'please'
  | 'goodbye';

const GESTURE_PHRASE: Record<GestureId, string> = {
  hello: 'Hello',
  yes: 'Yes',
  good_okay: 'Good, okay',
  no: 'No',
  wait: 'Wait',
  help: 'Help',
  assistance: 'I need assistance',
  thank_you: 'Thank you',
  please: 'Please',
  goodbye: 'Goodbye',
};

function dist2(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function dist(a: Landmark, b: Landmark) {
  return Math.sqrt(dist2(a, b));
}

function isFingerExtended(landmarks: Landmarks, mcp: number, pip: number, tip: number) {
  const wrist = landmarks[0];
  const m = landmarks[mcp];
  const p = landmarks[pip];
  const t = landmarks[tip];
  if (!wrist || !m || !p || !t) return false;

  // Finger is extended when the tip is significantly farther from the wrist than the PIP.
  // This is more rotation-tolerant than relying on y-only comparisons.
  return dist2(t, wrist) > dist2(p, wrist) + 0.01 && dist2(p, wrist) > dist2(m, wrist) + 0.005;
}

function isFingerCurled(landmarks: Landmarks, mcp: number, pip: number, tip: number) {
  const wrist = landmarks[0];
  const m = landmarks[mcp];
  const p = landmarks[pip];
  const t = landmarks[tip];
  if (!wrist || !m || !p || !t) return false;
  return dist2(t, wrist) + 0.008 < dist2(p, wrist);
}

function isThumbExtended(landmarks: Landmarks) {
  const wrist = landmarks[0];
  const tip = landmarks[4];
  const ip = landmarks[3];
  const mcp = landmarks[2];
  if (!wrist || !tip || !ip || !mcp) return false;
  return dist2(tip, wrist) > dist2(ip, wrist) + 0.008 && dist2(ip, wrist) > dist2(mcp, wrist) + 0.004;
}

type HandTrackerProps = {
  autoStart?: boolean;
  onPhrase?: (phrase: string, gestureId: GestureId) => void;
};

const HandTracker = ({ autoStart = true, onPhrase }: HandTrackerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [detectedText, setDetectedText] = useState("Waiting for gesture...");
  const [isCameraActive, setIsCameraActive] = useState(autoStart);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const lastSpokenTime = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const elevenLabsDisabledRef = useRef(false);
  const recentGesturesRef = useRef<GestureId[]>([]);
  const lastSpokenGestureRef = useRef<GestureId | null>(null);
  const waveRef = useRef<{ lastX: number | null; lastDir: -1 | 0 | 1; flips: number; startMs: number; minX: number; maxX: number }>({ lastX: null, lastDir: 0, flips: 0, startMs: 0, minX: 1, maxX: 0 });
  const stillRef = useRef<{ lastX: number | null; lastY: number | null; stillMs: number; lastMs: number }>({ lastX: null, lastY: null, stillMs: 0, lastMs: 0 });
  const startRequestedRef = useRef(autoStart);

  const speakViaBrowser = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  // Initialize MediaPipe
  useEffect(() => {
    const initMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        setHandLandmarker(landmarker);
        setIsModelReady(true);
      } catch (e) {
        console.error("Failed to initialize MediaPipe:", e);
      }
    };
    initMediaPipe();
  }, []);

  // The Bridge: Function to call your ElevenLabs API
  const speak = useCallback(async (text: string) => {
    const now = Date.now();
    if (now - lastSpokenTime.current < 3000) return; // 3-second cooldown

    setIsSpeaking(true);
    setDetectedText(text);
    lastSpokenTime.current = now;

    try {
      if (elevenLabsDisabledRef.current) {
        speakViaBrowser(text);
        return;
      }

      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => URL.revokeObjectURL(audioUrl);
        await audio.play();
        return;
      }

      // If ElevenLabs rejects the request (free-tier restrictions, unusual activity, etc),
      // fall back to browser TTS and stop spamming the terminal with repeated failing calls.
      let errorBody: SpeakErrorBody = null;
      try {
        errorBody = await response.json();
      } catch {
        // ignore
      }

      const errorText = extractSpeakErrorMessage(errorBody) ?? `TTS failed (status ${response.status})`;

      console.warn('ElevenLabs TTS failed:', response.status, errorText);
      setDetectedText('TTS fallback (device voice)');
      if (response.status === 401 || response.status === 403) {
        elevenLabsDisabledRef.current = true;
      }
      speakViaBrowser(text);
    } catch (error) {
      console.error("Voice Error:", error);
      setDetectedText('TTS fallback (device voice)');
      speakViaBrowser(text);
    } finally {
      setTimeout(() => setIsSpeaking(false), 2000);
    }
  }, [speakViaBrowser]);

  const classifyGesture = useCallback((landmarks: Landmarks): GestureId | null => {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbMcp = landmarks[2];
    const indexMcp = landmarks[5];
    if (!wrist || !thumbTip || !thumbMcp) return null;

    const thumb = isThumbExtended(landmarks);
    const index = isFingerExtended(landmarks, 5, 6, 8);
    const middle = isFingerExtended(landmarks, 9, 10, 12);
    const ring = isFingerExtended(landmarks, 13, 14, 16);
    const pinky = isFingerExtended(landmarks, 17, 18, 20);

    const indexCurled = isFingerCurled(landmarks, 5, 6, 8);
    const middleCurled = isFingerCurled(landmarks, 9, 10, 12);
    const ringCurled = isFingerCurled(landmarks, 13, 14, 16);
    const pinkyCurled = isFingerCurled(landmarks, 17, 18, 20);

    const thumbSpreadOk = indexMcp ? dist(thumbTip, indexMcp) > 0.12 : true;
    const palmFour = index && middle && ring && pinky;
    const openHand = thumbSpreadOk && thumb && palmFour; // ✋ hello base
    const fist = indexCurled && middleCurled && ringCurled && pinkyCurled && !index && !middle && !ring && !pinky; // 👊 yes (robust)
    const fourFingers = !thumb && palmFour; // 🤚 thank you

    // Wave detection for Goodbye: open hand + horizontal oscillation of wrist.
    // Track direction flips in ~1.5s window.
    // In practice many people wave with 4 fingers (thumb may be tucked), so detect waving
    // whenever the 4 fingers are extended.
    if (palmFour) {
      const now = performance.now();
      const s = waveRef.current;
      const lastX = s.lastX;
      const dx = lastX == null ? 0 : wrist.x - lastX;
      const dir: -1 | 0 | 1 = dx > 0.03 ? 1 : dx < -0.03 ? -1 : 0;

      if (s.startMs === 0) s.startMs = now;
      if (dir !== 0 && s.lastDir !== 0 && dir !== s.lastDir) s.flips += 1;
      if (dir !== 0) s.lastDir = dir;
      s.lastX = wrist.x;
      s.minX = Math.min(s.minX, wrist.x);
      s.maxX = Math.max(s.maxX, wrist.x);

      if (now - s.startMs > 1700) {
        s.startMs = now;
        s.flips = 0;
        s.lastDir = 0;
        s.minX = 1;
        s.maxX = 0;
      }

      const amplitude = s.maxX - s.minX;
      // Require a clearer wave: enough side-to-side distance + multiple direction flips,
      // and not just jitter for a few frames.
      if (now - s.startMs > 450 && s.flips >= 3 && amplitude > 0.14) {
        s.startMs = now;
        s.flips = 0;
        s.lastDir = 0;
        s.minX = 1;
        s.maxX = 0;
        return 'goodbye';
      }
    } else {
      // reset wave state when not open
      waveRef.current = { lastX: null, lastDir: 0, flips: 0, startMs: 0, minX: 1, maxX: 0 };
    }

    // "Please" approximation: open hand held still near center-lower region.
    // (We don't have body pose, so this approximates "hand on chest" as a stable held palm.)
    if (openHand || fourFingers) {
      const now = performance.now();
      const st = stillRef.current;
      const lastMs = st.lastMs || now;
      const dt = now - lastMs;
      const dx = st.lastX == null ? 0 : Math.abs(wrist.x - st.lastX);
      const dy = st.lastY == null ? 0 : Math.abs(wrist.y - st.lastY);
      const isStill = dx < 0.012 && dy < 0.012;
      st.stillMs = isStill ? st.stillMs + dt : 0;
      st.lastX = wrist.x;
      st.lastY = wrist.y;
      st.lastMs = now;

      // Approximate "hand on chest": stable palm held in the lower-middle of the frame.
      // Also allow it anywhere if the user holds the open palm still for long enough.
      const inChestZone = wrist.x > 0.30 && wrist.x < 0.70 && wrist.y > 0.45;
      if ((inChestZone && st.stillMs > 650) || st.stillMs > 1100) {
        st.stillMs = 0;
        return 'please';
      }
    } else {
      stillRef.current = { lastX: null, lastY: null, stillMs: 0, lastMs: 0 };
    }

    // Priority gestures (match the image)
    // 🤟 (ILY) -> I need assistance
    // Use "curled" checks for middle/ring so it works even if MediaPipe thinks they're slightly extended.
    if (thumb && index && pinky && (middleCurled || !middle) && (ringCurled || !ring)) return 'assistance';
    // Don't emit "thank you" while waving (goodbye is handled above).
    if (fourFingers) return 'thank_you'; // 4 fingers open -> thank you

    // 👍 / 👎
    if (thumb && !index && !middle && !ring && !pinky) {
      const up = thumbTip.y < Math.min(thumbMcp.y, wrist.y) - 0.06;
      const down = thumbTip.y > Math.max(thumbMcp.y, wrist.y) + 0.06;
      if (down) return 'no';
      if (up) return 'good_okay';
      return 'good_okay';
    }

    if (!thumb && index && middle && !ring && !pinky) return 'help'; // ✌ -> help
    if (!thumb && index && !middle && !ring && !pinky) return 'wait'; // ☝ -> wait
    if (fist) return 'yes'; // 👊 -> yes
    if (openHand) return 'hello'; // ✋ -> hello

    return null;
  }, []);

  const drawCanvas = useCallback((landmarks: Landmarks) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Draw connections (skeleton)
    ctx.strokeStyle = "#3b82f6"; // blue lines
    ctx.lineWidth = 3;
    for (const [start, end] of HAND_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
      ctx.stroke();
    }

    // Draw joints
    ctx.fillStyle = "#22c55e"; // green points
    for (const pt of landmarks) {
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setIsCameraActive(false);
    setIsStartingCamera(false);
  }, []);

  const refreshVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(videos);
      if (!selectedDeviceId && videos.length > 0) {
        setSelectedDeviceId(videos[0]?.deviceId ?? '');
      }
    } catch {
      // ignore
    }
  }, [selectedDeviceId]);

  const startCamera = useCallback(async () => {
    if (!videoRef.current) return;
    startRequestedRef.current = true;
    setCameraError(null);
    setIsStartingCamera(true);

    const video = videoRef.current;
    try {
      // Start camera regardless of model readiness; detection will start once the model loads.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setIsCameraActive(true);

      // After permission is granted, we can list device labels.
      await refreshVideoDevices();
    } catch (e) {
      console.error("Camera access error:", e);
      setCameraError("Camera access denied. Please allow permissions.");
      stopCamera();
    } finally {
      setIsStartingCamera(false);
    }
  }, [refreshVideoDevices, selectedDeviceId, stopCamera]);

  useEffect(() => {
    if (autoStart) {
      // auto-start once landmarker is ready
      startCamera();
    }
  }, [autoStart, startCamera]);

  useEffect(() => {
    refreshVideoDevices();
    const handler = () => refreshVideoDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [refreshVideoDevices]);

  // If user clicked "Enable Camera" before the model was ready, start detection once ready.
  useEffect(() => {
    if (!isModelReady) return;
    if (!startRequestedRef.current) return;
    // no-op: effect exists to re-run detection effect when model becomes ready
  }, [isModelReady]);

  useEffect(() => {
    if (!isCameraActive) return;
    if (!handLandmarker || !videoRef.current) return;

    let animationFrameId: number | null = null;
    const video = videoRef.current;

    const predict = () => {
      if (video.readyState >= 2) {
        const results = handLandmarker.detectForVideo(video, performance.now());
        const landmarks = results.landmarks?.[0] as Landmarks | undefined;
        if (landmarks && landmarks.length > 0) {
          const g = classifyGesture(landmarks);
          if (g) {
            const recent = recentGesturesRef.current;
            recent.push(g);
            if (recent.length > 8) recent.shift();

            // Majority vote for stability
            const counts = new Map<GestureId, number>();
            for (const it of recent) counts.set(it, (counts.get(it) ?? 0) + 1);
            let best: GestureId | null = null;
            let bestCount = 0;
            for (const [k, v] of counts.entries()) {
              if (v > bestCount) {
                best = k;
                bestCount = v;
              }
            }

            if (best && bestCount >= 5) {
              setDetectedText(GESTURE_PHRASE[best]);
              const now = Date.now();
              const cooldownOk = now - lastSpokenTime.current >= 2500;
              if (cooldownOk && lastSpokenGestureRef.current !== best) {
                lastSpokenGestureRef.current = best;
                onPhrase?.(GESTURE_PHRASE[best], best);
                speak(GESTURE_PHRASE[best]);
              }
            }
          }
          drawCanvas(landmarks);
        }
      }
      animationFrameId = requestAnimationFrame(predict);
    };

    predict();

    return () => {
      if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
    };
  }, [classifyGesture, drawCanvas, handLandmarker, isCameraActive, onPhrase, speak]);

  return (
    <div className="relative w-full max-w-2xl mx-auto bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
      <video ref={videoRef} className="w-full h-auto" playsInline muted />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" width={640} height={480} />

      {/* Camera controls */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-white backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
          <Camera className="h-4 w-4" />
          Camera
        </div>

        <select
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          disabled={isCameraActive || videoDevices.length === 0}
          className="max-w-[220px] rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/90 outline-none disabled:opacity-60"
          title={isCameraActive ? 'Stop camera to switch devices' : 'Select camera device'}
        >
          {videoDevices.length === 0 ? (
            <option value="">No camera devices</option>
          ) : (
            videoDevices.map((d, idx) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${idx + 1}`}
              </option>
            ))
          )}
        </select>

        {!isCameraActive ? (
          <button
            type="button"
            onClick={startCamera}
            disabled={isStartingCamera}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-black disabled:opacity-70"
          >
            {isStartingCamera ? 'Starting…' : 'Start'}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopCamera}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/15 transition-colors"
            title="Stop camera"
          >
            <CircleStop className="h-3.5 w-3.5" />
            Stop
          </button>
        )}
      </div>

      {!isCameraActive && (
        <div className="absolute inset-0 grid place-items-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-6 text-center text-white backdrop-blur-xl">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/10">
              <Camera className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold">Camera inactive</p>
            <p className="mt-1 text-xs text-white/70">Enable camera to start translating sign language</p>
            {!isModelReady && <p className="mt-2 text-[11px] font-semibold text-white/70">Loading hand model…</p>}
            {cameraError && <p className="mt-3 text-xs font-semibold text-yellow-300">{cameraError}</p>}
            <button
              onClick={startCamera}
              disabled={isStartingCamera}
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-bold text-black hover:opacity-90 transition-opacity"
            >
              {isStartingCamera ? 'Starting…' : 'Enable Camera'}
            </button>
          </div>
        </div>
      )}
      
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-linear-to-t from-black to-transparent">
        <AnimatePresence>
          {isSpeaking && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 bg-yellow-400 text-black px-6 py-3 rounded-full font-bold shadow-xl mx-auto w-fit"
            >
              <Volume2 className="animate-pulse" />
              {detectedText}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default HandTracker;