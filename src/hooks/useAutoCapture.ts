// src/hooks/useAutoCapture.ts
// Hook que implementa la detección automática periódica para iOS.
// Usa takePhoto (con shutter silenciado) porque takeSnapshot no está soportado
// de forma fiable en VisionCamera v4 con New Architecture.

import { useCallback, useEffect, useRef } from 'react';
import type { Camera } from 'react-native-vision-camera';
import NativeDocumentScanner from '../NativeDocumentScanner';
import type { TierConfig } from '../utils/deviceTier';

interface AutoCaptureOptions {
  cameraRef:        React.RefObject<Camera | null>;
  /** Ref compartido: true mientras captureQuality está en curso. */
  captureLockedRef: React.RefObject<boolean>;
  tierConfig:       TierConfig;
  enabled:          boolean;
  onDetected:       () => void;
  onNotDetected:    () => void;
}

export function useAutoCapture({
  cameraRef,
  captureLockedRef,
  tierConfig,
  enabled,
  onDetected,
  onNotDetected,
}: AutoCaptureOptions): void {

  const isProcessingRef = useRef(false);
  // Ref que refleja enabled sin recrear analyze en cada cambio de enabled.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Timestamp del momento en que enabled se volvió true.
  // Sirve para dar tiempo a iOS de inicializar la sesión de cámara antes
  // del primer intento de captura (evita -17281 FigCaptureSourceRemote).
  const enabledAtRef   = useRef(0);
  // Timestamp del último error de cámara; impone un backoff antes de reintentar.
  const lastErrorAtRef = useRef(0);

  useEffect(() => {
    if (enabled) {
      enabledAtRef.current = Date.now();
    }
  }, [enabled]);

  const analyze = useCallback(async () => {
    if (isProcessingRef.current)  return;
    if (!enabledRef.current)      return;
    if (captureLockedRef.current) return; // captura de calidad en progreso
    if (!cameraRef.current)       return;

    const now = Date.now();
    // Warmup: esperar al menos 1500 ms desde que la cámara se activó para que
    // iOS termine de inicializar la sesión AVCaptureSession antes de capturar.
    if (now - enabledAtRef.current < 1500) return;
    // Backoff: tras un error de cámara esperar 2000 ms antes de reintentar.
    if (now - lastErrorAtRef.current < 2000) return;

    isProcessingRef.current = true;

    try {
      if (!enabledRef.current || captureLockedRef.current) return;

      // takePhoto con shutter silenciado para no molestar al usuario en el bucle
      // de detección. flash off para evitar destellos repetidos.
      const snapshot = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
      });

      if (!enabledRef.current || captureLockedRef.current) return;

      const result = await NativeDocumentScanner.detectDocumentInImage(snapshot.path);

      if (!enabledRef.current || captureLockedRef.current) return;

      if (result !== null) {
        onDetected();
      } else {
        onNotDetected();
      }
    } catch (_error) {
      // Registrar el momento del error para activar el backoff.
      lastErrorAtRef.current = Date.now();
      if (!captureLockedRef.current) {
        onNotDetected();
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [cameraRef, captureLockedRef, onDetected, onNotDetected]);

  useEffect(() => {
    if (!enabled) return;
    const intervalId = setInterval(analyze, tierConfig.intervalMs);
    return () => clearInterval(intervalId);
  }, [enabled, analyze, tierConfig.intervalMs]);
}
