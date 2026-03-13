// src/components/DocumentScanner.tsx
// Componente principal del escáner de documentos.
// Maneja el ciclo completo: cámara → detección → estabilidad → captura → preview → resultado.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import type { DocumentScannerProps, ScanResult } from '../types';
import { useAutoCapture } from '../hooks/useAutoCapture';
import { getDeviceTierConfig, type TierConfig } from '../utils/deviceTier';
import NativeDocumentScanner from '../NativeDocumentScanner';

type ScanState =
  | 'searching'     // Buscando documento, ninguno detectado
  | 'detected'      // Documento detectado, esperando estabilidad
  | 'stabilizing'   // Contando delay de estabilidad
  | 'capturing'     // Tomando foto en modo quality
  | 'processing'    // Aplicando corrección de perspectiva
  | 'preview';      // Mostrando preview para confirmar o repetir

const STATE_HINTS: Record<ScanState, string> = {
  searching:   'Apunta la cámara hacia el documento',
  detected:    'Documento detectado — mantén firme',
  stabilizing: 'Manteniendo posición...',
  capturing:   'Capturando...',
  processing:  'Procesando...',
  preview:     '',
};

export function DocumentScanner({ onCapture, onCancel, title, frameRatio = 1.41, forceHorizontal = true }: DocumentScannerProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef<Camera | null>(null);

  const [scanState, setScanState]   = useState<ScanState>('searching');
  const [tierConfig, setTierConfig] = useState<TierConfig>({ intervalMs: 800, stabilityDelayMs: 700 });
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [cameraKey, setCameraKey]   = useState(0);
  const [isActive, setIsActive]     = useState(true);

  /** true mientras captureQuality está en curso; impide que analyze() interfiera. */
  const captureLockedRef     = useRef(false);
  const stabilityTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalResultRef       = useRef<ScanResult | null>(null);
  /** Contador de fotogramas sin documento; para tolerancia de temblores en iOS. */
  const consecutiveMissesRef = useRef(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ─── Inicialización ───────────────────────────────────────────────────────

  useEffect(() => {
    getDeviceTierConfig().then(setTierConfig);
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ─── Fix MIUI/HyperOS: cámara negra al volver de background ──────────────
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        setIsActive(false);
        const delay = Platform.OS === 'android' ? 150 : 0;
        setTimeout(() => {
          setCameraKey(prev => prev + 1);
          setIsActive(true);
        }, delay);
      } else if (nextState === 'background' || nextState === 'inactive') {
        setIsActive(false);
      }
    });

    return () => subscription.remove();
  }, []);

  // ─── Animación de pulso ───────────────────────────────────────────────────

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // ─── Captura en calidad ───────────────────────────────────────────────────

  const captureQuality = useCallback(async () => {
    if (!cameraRef.current) return;
    captureLockedRef.current = true;
    stopPulse();
    setScanState('capturing');

    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });

      setScanState('processing');

      const result = await NativeDocumentScanner.detectDocumentInImage(photo.path);

      let tlX: number, tlY: number, trX: number, trY: number;
      let brX: number, brY: number, blX: number, blY: number;
      let imageWidth: number, imageHeight: number;

      if (result !== null && result.corners !== null) {
        tlX = result.corners.topLeft.x;     tlY = result.corners.topLeft.y;
        trX = result.corners.topRight.x;    trY = result.corners.topRight.y;
        brX = result.corners.bottomRight.x; brY = result.corners.bottomRight.y;
        blX = result.corners.bottomLeft.x;  blY = result.corners.bottomLeft.y;
        imageWidth  = result.imageWidth;
        imageHeight = result.imageHeight;
      } else {
        // Fallback: recortar al área del marco guía centrado en la imagen.
        // Usamos Image.getSize para obtener las dimensiones reales del archivo
        // YA orientado (el nativo llama correctOrientation antes de cualquier op),
        // evitando confusión con las dimensiones del sensor (photo.width/height).
        const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
        const { width: imgW, height: imgH } = await new Promise<{ width: number; height: number }>(
          (resolve, reject) => Image.getSize(fileUri, (w, h) => resolve({ width: w, height: h }), reject)
        );

        const frameW = imgW * 0.80;
        const frameH = frameW * frameRatio;
        const frameX = (imgW - frameW) / 2;
        const frameY = (imgH - frameH) / 2;
        tlX = frameX;          tlY = frameY;
        trX = frameX + frameW; trY = frameY;
        brX = frameX + frameW; brY = frameY + frameH;
        blX = frameX;          blY = frameY + frameH;
        imageWidth  = imgW;
        imageHeight = imgH;
      }

      // Determinar orientación del DOCUMENTO usando geometría de las esquinas,
      // no el campo orientation del sensor (que puede ser "portrait" aunque los
      // píxeles de la imagen sean landscape, e.g. en takeSnapshot).
      if (forceHorizontal) {
        const docW = Math.sqrt((trX - tlX) ** 2 + (trY - tlY) ** 2);
        const docH = Math.sqrt((blX - tlX) ** 2 + (blY - tlY) ** 2);
        if (docH > docW) {
          [tlX, tlY, trX, trY, brX, brY, blX, blY] = [blX, blY, tlX, tlY, trX, trY, brX, brY];
        }
      }

      const rawUri = await NativeDocumentScanner.cropAndCorrectPerspective(
        photo.path,
        tlX, tlY, trX, trY, brX, brY, blX, blY,
      );

      const normalizedUri = rawUri.startsWith('file://') ? rawUri : `file://${rawUri}`;
      const base64 = await NativeDocumentScanner.readFileAsBase64(
        normalizedUri.replace('file://', ''),
      );

      finalResultRef.current = {
        uri:            normalizedUri,
        base64,
        originalWidth:  imageWidth,
        originalHeight: imageHeight,
      };

      setPreviewUri(normalizedUri);
      setScanState('preview');
    } catch (error) {
      console.error('[DocumentScanner] captureQuality failed:', error);
      setScanState('searching');
    } finally {
      captureLockedRef.current = false;
    }
  }, [stopPulse, frameRatio, forceHorizontal]);

  // ─── Callbacks de detección ───────────────────────────────────────────────

  const handleDetected = useCallback(() => {
    consecutiveMissesRef.current = 0;
    if (scanState === 'capturing' || scanState === 'processing' || scanState === 'preview') return;
    if (scanState === 'stabilizing') return;

    if (scanState === 'searching') {
      startPulse();
    }

    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
    }

    setScanState('stabilizing');
    stabilityTimerRef.current = setTimeout(() => {
      captureQuality();
    }, tierConfig.stabilityDelayMs);
  }, [scanState, tierConfig.stabilityDelayMs, startPulse, captureQuality]);

  const handleNotDetected = useCallback(() => {
    // Si captureQuality está en curso no cancelar.
    if (captureLockedRef.current) return;
    // iOS: tolerar hasta 4 fotogramas perdidos seguidos para absorber temblores leves.
    if (Platform.OS === 'ios') {
      consecutiveMissesRef.current += 1;
      if (consecutiveMissesRef.current < 5) return;
    }
    if (scanState === 'detected' || scanState === 'stabilizing') {
      if (stabilityTimerRef.current) {
        clearTimeout(stabilityTimerRef.current);
        stabilityTimerRef.current = null;
      }
      setScanState('searching');
      stopPulse();
    }
  }, [scanState, stopPulse]);

  // ─── Acciones del usuario ─────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    if (finalResultRef.current) {
      onCapture(finalResultRef.current);
    }
  }, [onCapture]);

  const handleRetry = useCallback(() => {
    setPreviewUri(null);
    finalResultRef.current = null;
    setScanState('searching');
  }, []);

  const handleManualCapture = useCallback(() => {
    if (scanState === 'capturing' || scanState === 'processing' || scanState === 'preview') return;

    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }

    captureQuality();
  }, [scanState, captureQuality]);

  // ─── Hook de captura automática ───────────────────────────────────────────

  // Android: modo manual puro — sin bucle de análisis para evitar congelamiento.
  const autoCaptureEnabled = Platform.OS === 'ios' &&
    (scanState === 'searching' || scanState === 'detected' || scanState === 'stabilizing');

  useAutoCapture({
    cameraRef,
    captureLockedRef,
    tierConfig,
    enabled:       autoCaptureEnabled && isActive,
    onDetected:    handleDetected,
    onNotDetected: handleNotDetected,
  });

  // ─── Renderizado ──────────────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Se necesita permiso de cámara para escanear documentos.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Conceder permiso</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Cámara trasera no disponible.</Text>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cerrar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (scanState === 'preview' && previewUri) {
    return (
      <View style={styles.previewContainer}>
        <Text style={styles.previewTitle}>Resultado del escaneo</Text>
        <Image
          source={{ uri: previewUri }}
          style={styles.previewImage}
          resizeMode="contain"
        />
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Repetir</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
            <Text style={styles.confirmButtonText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isDocumentDetected = scanState === 'detected' || scanState === 'stabilizing';
  // Android: no hay detección automática; indicar al usuario que use el botón.
  const hint = (Platform.OS === 'android' && scanState === 'searching')
    ? 'Encuadra el documento y pulsa el botón'
    : STATE_HINTS[scanState];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title ?? 'Escanear documento'}</Text>
        <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <Camera
        key={cameraKey}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={true}
        photoQualityBalance="speed"
      />

      <View style={styles.overlay} pointerEvents="none">
        <Animated.View
          style={[
            styles.frame,
            { aspectRatio: 1 / frameRatio },
            isDocumentDetected && {
              borderColor: '#4CAF50',
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
      </View>

      <View style={styles.hintContainer} pointerEvents="none">
        <Text style={styles.hintText}>{hint}</Text>
      </View>

      {(scanState === 'searching' || scanState === 'detected' || scanState === 'stabilizing') && (
        <View style={styles.captureButtonContainer}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleManualCapture}
            activeOpacity={0.8}
          >
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 20,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: '80%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
    borderRadius: 8,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: '#fff',
    fontSize: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  captureButtonContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#000',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
  },
  previewTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 60,
    marginBottom: 20,
  },
  previewImage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#111',
  },
  previewActions: {
    flexDirection: 'row',
    paddingVertical: 24,
    paddingHorizontal: 24,
    gap: 16,
  },
  retryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
