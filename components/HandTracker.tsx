'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { Camera, CircleStop, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

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
  | 'goodbye'
  | 'water'
  | 'restroom'
  | 'stop';

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
  water: 'I need water',
  restroom: 'I need the restroom',
  stop: 'Please stop',
};

function dist2(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function dist(a: Landmark, b: Landmark) {
  return Math.sqrt(dist2(a, b));
}

function getHandSize(landmarks: Landmarks) {
  // Dynamic scale reference: wrist -> middle MCP distance
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  if (!wrist || !middleMcp) return 0;
  return dist(wrist, middleMcp);
}

function isFingerExtended(landmarks: Landmarks, mcp: number, pip: number, tip: number, handSize: number) {
  const wrist = landmarks[0];
  const m = landmarks[mcp];
  const p = landmarks[pip];
  const t = landmarks[tip];
  if (!wrist || !m || !p || !t) return false;

  // Finger is extended when the tip is significantly farther from the wrist than the PIP.
  // This is more rotation-tolerant than relying on y-only comparisons.
  const hs2 = Math.max(handSize, 0.0001) ** 2;
  return dist2(t, wrist) > dist2(p, wrist) + 0.16 * hs2 && dist2(p, wrist) > dist2(m, wrist) + 0.08 * hs2;
}

function isFingerCurled(landmarks: Landmarks, mcp: number, pip: number, tip: number, handSize: number) {
  const wrist = landmarks[0];
  const m = landmarks[mcp];
  const p = landmarks[pip];
  const t = landmarks[tip];
  if (!wrist || !m || !p || !t) return false;
  const hs2 = Math.max(handSize, 0.0001) ** 2;
  return dist2(t, wrist) + 0.128 * hs2 < dist2(p, wrist);
}

function isThumbExtended(landmarks: Landmarks, handSize: number) {
  const wrist = landmarks[0];
  const tip = landmarks[4];
  const ip = landmarks[3];
  const mcp = landmarks[2];
  if (!wrist || !tip || !ip || !mcp) return false;
  const hs2 = Math.max(handSize, 0.0001) ** 2;
  return dist2(tip, wrist) > dist2(ip, wrist) + 0.128 * hs2 && dist2(ip, wrist) > dist2(mcp, wrist) + 0.064 * hs2;
}

type HandTrackerProps = {
  autoStart?: boolean;
  onPhrase?: (phrase: string, gestureId: GestureId) => void;
  voiceId?: string;
  modelId?: string;
};

const LOCK_FRAMES = 10;
const HandTracker = ({ autoStart = true, onPhrase, voiceId, modelId }: HandTrackerProps) => {
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
  const lastSpokenGestureRef = useRef<GestureId | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [lockedGesture, setLockedGesture] = useState<GestureId | null>(null);
  const lockedGestureRef = useRef<GestureId | null>(null);
  const lockUiTimeoutRef = useRef<number | null>(null);
  const lockStateRef = useRef<{ candidate: GestureId | null; streak: number }>({ candidate: null, streak: 0 });
  const waveRef = useRef<{ lastX: number | null; lastDir: -1 | 0 | 1; flips: number; startMs: number; minX: number; maxX: number }>({ lastX: null, lastDir: 0, flips: 0, startMs: 0, minX: 1, maxX: 0 });
  const stillRef = useRef<{ lastX: number | null; lastY: number | null; stillMs: number; lastMs: number }>({ lastX: null, lastY: null, stillMs: 0, lastMs: 0 });
  const startRequestedRef = useRef(autoStart);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number>(0);
  const calibrationRef = useRef<{
    baselineHandSize: number;
    brightness: number;
    isReady: boolean;
    startedAt: number;
    samples: number;
    sumHandSize: number;
    sumBrightness: number;
  }>({ baselineHandSize: 0, brightness: 0, isReady: false, startedAt: 0, samples: 0, sumHandSize: 0, sumBrightness: 0 });

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
          numHands: 2
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
        body: JSON.stringify({ text, voiceId, modelId }),
      });

      if (response.ok) {
        // Stream as it downloads (browser will start playing as enough data is buffered).
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        if (!audioRef.current) audioRef.current = new Audio();
        const audio = audioRef.current;
        audio.src = audioUrl;
        audio.onended = () => URL.revokeObjectURL(audioUrl);
        await audio.play().catch(() => {
          // If autoplay policy blocks, fall back to device voice.
          URL.revokeObjectURL(audioUrl);
          speakViaBrowser(text);
        });
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
      toast.warning('Voice engine offline. Using device voice.', { description: errorText });
      if (response.status === 401 || response.status === 403) {
        elevenLabsDisabledRef.current = true;
      }
      speakViaBrowser(text);
    } catch (error) {
      console.error("Voice Error:", error);
      setDetectedText('TTS fallback (device voice)');
      toast.warning('Voice engine offline. Using device voice.');
      speakViaBrowser(text);
    } finally {
      setTimeout(() => setIsSpeaking(false), 2000);
    }
  }, [modelId, speakViaBrowser, voiceId]);

  const classifyGesture = useCallback((landmarks: Landmarks): GestureId | null => {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbMcp = landmarks[2];
    const indexMcp = landmarks[5];
    if (!wrist || !thumbTip || !thumbMcp) return null;

    const handSize = getHandSize(landmarks);
    const hs = Math.max(handSize, calibrationRef.current.baselineHandSize || 0, 0.0001);

    const thumb = isThumbExtended(landmarks, hs);
    const index = isFingerExtended(landmarks, 5, 6, 8, hs);
    const middle = isFingerExtended(landmarks, 9, 10, 12, hs);
    const ring = isFingerExtended(landmarks, 13, 14, 16, hs);
    const pinky = isFingerExtended(landmarks, 17, 18, 20, hs);

    const indexCurled = isFingerCurled(landmarks, 5, 6, 8, hs);
    const middleCurled = isFingerCurled(landmarks, 9, 10, 12, hs);
    const ringCurled = isFingerCurled(landmarks, 13, 14, 16, hs);
    const pinkyCurled = isFingerCurled(landmarks, 17, 18, 20, hs);

    const thumbSpreadOk = indexMcp ? dist(thumbTip, indexMcp) > 0.48 * hs : true;
    const palmFour = index && middle && ring && pinky;
    const openHand = thumbSpreadOk && thumb && palmFour; // ✋ hello base
    const fist = indexCurled && middleCurled && ringCurled && pinkyCurled && !index && !middle && !ring && !pinky; // 👊 yes (robust)
    const fourFingers = !thumb && palmFour; // 🤚 thank you
    const waterShape = !thumb && index && middle && ring && !pinky; // "W" shape -> water

    // Wave detection for Goodbye: open hand + horizontal oscillation of wrist.
    // Track direction flips in ~1.5s window.
    // In practice many people wave with 4 fingers (thumb may be tucked), so detect waving
    // whenever the 4 fingers are extended.
    if (palmFour) {
      const now = performance.now();
      const s = waveRef.current;
      const lastX = s.lastX;
      const dx = lastX == null ? 0 : wrist.x - lastX;
      const dirThreshold = 0.12 * hs;
      const dir: -1 | 0 | 1 = dx > dirThreshold ? 1 : dx < -dirThreshold ? -1 : 0;

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
      if (now - s.startMs > 450 && s.flips >= 3 && amplitude > 0.56 * hs) {
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

    // "Please" and "Stop" approximation: open hand held still.
    // (We don't have body pose, so we approximate zones in the frame.)
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

      // Upper-middle stable palm -> "stop"
      const inStopZone = wrist.x > 0.25 && wrist.x < 0.75 && wrist.y < 0.45;
      if (inStopZone && st.stillMs > 650) {
        st.stillMs = 0;
        return 'stop';
      }

      // Lower-middle stable palm -> "please"
      const inChestZone = wrist.x > 0.30 && wrist.x < 0.70 && wrist.y > 0.45;
      if ((inChestZone && st.stillMs > 650) || st.stillMs > 1100) {
        st.stillMs = 0;
        return 'please';
      }
    } else {
      stillRef.current = { lastX: null, lastY: null, stillMs: 0, lastMs: 0 };
    }

    // Daily-use / emergency gestures.
    if (waterShape) return 'water'; // "W" hand -> I need water

    // Priority gestures (match the image)
    // 🤟 (ILY) -> I need assistance
    // Use "curled" checks for middle/ring so it works even if MediaPipe thinks they're slightly extended.
    if (thumb && index && pinky && (middleCurled || !middle) && (ringCurled || !ring)) return 'assistance';
    // Don't emit "thank you" while waving (goodbye is handled above).
    if (fourFingers) return 'thank_you'; // 4 fingers open -> thank you

    // 👍 / 👎
    if (thumb && !index && !middle && !ring && !pinky) {
      const yThresh = 0.24 * hs;
      const up = thumbTip.y < Math.min(thumbMcp.y, wrist.y) - yThresh;
      const down = thumbTip.y > Math.max(thumbMcp.y, wrist.y) + yThresh;
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

  const drawCanvas = useCallback((landmarks: Landmarks, isLocked: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Draw connections (skeleton)
    ctx.strokeStyle = isLocked ? "#22c55e" : "#3b82f6"; // green when locked, else blue
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
    ctx.fillStyle = isLocked ? "#22c55e" : "#60a5fa";
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

      // Start a short calibration window (3s) for dynamic thresholds + ambient brightness.
      calibrationRef.current = { baselineHandSize: 0, brightness: 0, isReady: false, startedAt: performance.now(), samples: 0, sumHandSize: 0, sumBrightness: 0 };
      setIsCalibrating(true);
      setCalibrationCountdown(3);

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
        const lm0 = (results.landmarks?.[0] as Landmarks | undefined) ?? undefined;
        const lm1 = (results.landmarks?.[1] as Landmarks | undefined) ?? undefined;

        // Calibration sampling (3 seconds).
        if (isCalibrating) {
          const now = performance.now();
          const elapsed = now - calibrationRef.current.startedAt;
          const remaining = Math.max(0, 3000 - elapsed);
          const sec = Math.ceil(remaining / 1000);
          if (sec !== calibrationCountdown) setCalibrationCountdown(sec);

          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) {
            try {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, 64, 48).data; // small sample
              let sum = 0;
              for (let i = 0; i < img.length; i += 4) {
                const r = img[i] ?? 0;
                const g = img[i + 1] ?? 0;
                const b = img[i + 2] ?? 0;
                sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
              }
              const avg = sum / (img.length / 4) / 255;
              calibrationRef.current.sumBrightness += avg;
            } catch {
              // ignore CORS-ish failures (shouldn't happen for camera)
            }
          }

          const hs0 = lm0 ? getHandSize(lm0) : 0;
          const hs1 = lm1 ? getHandSize(lm1) : 0;
          const hs = Math.max(hs0, hs1);
          if (hs > 0) calibrationRef.current.sumHandSize += hs;
          calibrationRef.current.samples += 1;

          if (elapsed >= 3000) {
            const samples = Math.max(1, calibrationRef.current.samples);
            calibrationRef.current.baselineHandSize = calibrationRef.current.sumHandSize / samples;
            calibrationRef.current.brightness = calibrationRef.current.sumBrightness / samples;
            calibrationRef.current.isReady = true;
            setIsCalibrating(false);
            setCalibrationCountdown(0);
            toast.success('Calibration complete');
          }
        }

        // Gesture detection: take best of both hands, plus simple two-hand interactions.
        const g0 = lm0 && lm0.length > 0 ? classifyGesture(lm0) : null;
        const g1 = lm1 && lm1.length > 0 ? classifyGesture(lm1) : null;

        let combined: GestureId | null = null;
        if (lm0 && lm1 && lm0[0] && lm1[0]) {
          const hs = Math.max(getHandSize(lm0), getHandSize(lm1), calibrationRef.current.baselineHandSize || 0, 0.0001);
          const wristsClose = dist(lm0[0], lm1[0]) < 0.55 * hs;
          const lowHands = lm0[0].y > 0.55 && lm1[0].y > 0.55;

          // Two fists low and close -> restroom
          if (wristsClose && lowHands && g0 === 'yes' && g1 === 'yes') {
            combined = 'restroom';
          } else if (
            wristsClose &&
            (g0 === 'hello' || g0 === 'thank_you' || g0 === 'please') &&
            (g1 === 'hello' || g1 === 'thank_you' || g1 === 'please')
          ) {
            // Hands together with open palms -> please (namaste-like)
            combined = 'please';
          }
        }

        const candidate = combined ?? g0 ?? g1;
        const lock = lockStateRef.current;
        if (candidate && candidate === lock.candidate) {
          lock.streak += 1;
        } else {
          lock.candidate = candidate;
          lock.streak = candidate ? 1 : 0;
        }

        if (candidate) {
          setDetectedText(GESTURE_PHRASE[candidate]);
        }

        if (candidate && lock.streak >= LOCK_FRAMES) {
          const nowMs = Date.now();
          const cooldownOk = nowMs - lastSpokenTime.current >= 2500;
          if (cooldownOk && lastSpokenGestureRef.current !== candidate) {
            lastSpokenGestureRef.current = candidate;
            lockedGestureRef.current = candidate;
            setLockedGesture(candidate);
            if (lockUiTimeoutRef.current) window.clearTimeout(lockUiTimeoutRef.current);
            lockUiTimeoutRef.current = window.setTimeout(() => setLockedGesture(null), 900);

            try {
              window.navigator?.vibrate?.(25);
            } catch {
              // ignore
            }

            onPhrase?.(GESTURE_PHRASE[candidate], candidate);
            speak(GESTURE_PHRASE[candidate]);
          }
        }

        // Draw whichever hand we have (prefer first).
        const drawLm = lm0 && lm0.length > 0 ? lm0 : lm1 && lm1.length > 0 ? lm1 : null;
        if (drawLm) drawCanvas(drawLm, Boolean(lockedGestureRef.current));
      }
      animationFrameId = requestAnimationFrame(predict);
    };

    predict();

    return () => {
      if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
    };
  }, [calibrationCountdown, classifyGesture, drawCanvas, handLandmarker, isCalibrating, isCameraActive, onPhrase, speak]);

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

      {isCameraActive && isCalibrating && (
        <div className="absolute inset-0 grid place-items-center bg-black/35 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-6 text-center text-white backdrop-blur-xl">
            <p className="text-sm font-semibold">Calibrating…</p>
            <p className="mt-1 text-xs text-white/80">
              Hold your hand comfortably in view. Starting in <span className="font-black">{calibrationCountdown}</span>
            </p>
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