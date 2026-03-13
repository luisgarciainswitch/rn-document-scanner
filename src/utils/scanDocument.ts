// src/utils/scanDocument.ts
// API headless para detectar y recortar un documento desde una imagen
// sin necesidad de mostrar ninguna UI de cámara.
//
// Uso:
//   import { scanDocumentFile } from 'rn-document-scanner';
//
//   // Desde ruta de archivo
//   const result = await scanDocumentFile('file:///path/to/photo.jpg');
//
//   // Desde base64
//   const result = await scanDocumentFile({ base64: '...' }, { forceHorizontal: true });

import { Image } from 'react-native';
import NativeDocumentScanner from '../NativeDocumentScanner';
import type { ScanResult, ScanDocumentOptions, DocumentCorners, Point, QualityInfo } from '../types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

// ScanDocumentOptions is defined in types.ts and re-exported from index.ts

// ─── Helpers internos ─────────────────────────────────────────────────────────

function euclidean(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Rota las esquinas 90 ° en sentido horario. El lado izquierdo del
 * documento portrait se convierte en el borde superior del landscape.
 *
 *   nuevo TL = viejo BL
 *   nuevo TR = viejo TL
 *   nuevo BR = viejo TR
 *   nuevo BL = viejo BR
 *
 * Esto hace que `cropAndCorrectPerspective` calcule:
 *   outputWidth  = |nuevo TL → nuevo TR| = lado izquierdo del portrait (eje largo) ✓
 *   outputHeight = |nuevo TL → nuevo BL| = lado inferior del portrait  (eje corto) ✓
 */
function rotateCW90(corners: DocumentCorners): DocumentCorners {
  return {
    topLeft:     corners.bottomLeft,
    topRight:    corners.topLeft,
    bottomRight: corners.topRight,
    bottomLeft:  corners.bottomRight,
  };
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
  return new Promise((resolve, reject) => {
    Image.getSize(fileUri, (width, height) => resolve({ width, height }), reject);
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Detecta el documento en la imagen indicada, aplica corrección de
 * perspectiva y devuelve la URI del recorte final.
 *
 * @param input  Ruta del archivo (`file:///…` o ruta sin esquema) **o**
 *               un objeto `{ base64: string }` con la imagen codificada.
 * @param options Opciones de comportamiento (ver `ScanDocumentOptions`).
 */
export async function scanDocumentFile(
  input: string | { base64: string },
  options: ScanDocumentOptions = {},
): Promise<ScanResult> {
  const {
    forceHorizontal    = false,
    cameraViewLayout,
    guideFrameLayout,
    fallbackAspectRatio = 1.41,
    onNoDetection      = 'fallback',
  } = options;

  // ── 1. Resolver ruta de archivo ───────────────────────────────────────────
  let filePath: string;
  if (typeof input === 'string') {
    filePath = input.startsWith('file://') ? input.replace('file://', '') : input;
  } else {
    const tempUri = await NativeDocumentScanner.saveBase64ImageToTemp(input.base64);
    filePath = tempUri.replace('file://', '');
  }

  // ── 2+3. Detectar documento, obtener dimensiones y esquinas ─────────────────
  // detectDocumentInImage llama primero a correctOrientation() en Android
  // (rota el JPEG en disco si tiene EXIF de rotación) → las dimensiones que
  // devuelve y las que Image.getSize lee siempre corresponden a la imagen
  // ya correctamente orientada. En iOS el JPEG de takePhoto() ya viene orientado.
  let imageWidth: number;
  let imageHeight: number;
  let corners: DocumentCorners;
  let quality: QualityInfo | undefined;

  const detection = await NativeDocumentScanner.detectDocumentInImage(filePath);

  if (detection !== null && detection.corners !== null) {
    // ── Ruta A: OpenCV detectó el documento → esquinas precisas ─────────────
    // Usar las dimensiones devueltas por el nativo: ya corresponden al JPEG
    // corregido en orientación (Android aplica correctOrientation() antes de
    // llamar a OpenCV).
    imageWidth  = detection.imageWidth;
    imageHeight = detection.imageHeight;
    corners = detection.corners;
    quality = detection.quality;
  } else {
    quality = detection?.quality;

    if (detection !== null) {
      // Imagen legible pero sin documento detectado — usar dimensiones de OpenCV.
      imageWidth  = detection.imageWidth;
      imageHeight = detection.imageHeight;
    } else {
      // En Android, detectDocumentInImage ya habrá corregido el EXIF y sobreescrito
      // el archivo → Image.getSize devuelve las dimensiones reales post-corrección.
      // En iOS el JPEG ya viene orientado correctamente desde takePhoto().
      const corrected = await getImageSize(filePath);
      imageWidth  = corrected.width;
      imageHeight = corrected.height;
    }

    if (cameraViewLayout && guideFrameLayout) {
      // ── Fallback A: Recorte por coordenadas de pantalla ────────────────────
      // Escalas: cuántos píxeles de imagen corresponden a 1 punto de pantalla.
      const scaleX = imageWidth  / cameraViewLayout.width;
      const scaleY = imageHeight / cameraViewLayout.height;

      // Intersección del guideFrame con el cameraView en coordenadas de pantalla.
      // Esto maneja artefactos de medición donde el guideFrame puede aparecer
      // ligeramente fuera de los límites del cameraView (sombras, bordes, etc.).
      const intersectLeft   = Math.max(guideFrameLayout.left, cameraViewLayout.left);
      const intersectTop    = Math.max(guideFrameLayout.top,  cameraViewLayout.top);
      const intersectRight  = Math.min(
        guideFrameLayout.left + guideFrameLayout.width,
        cameraViewLayout.left + cameraViewLayout.width,
      );
      const intersectBottom = Math.min(
        guideFrameLayout.top  + guideFrameLayout.height,
        cameraViewLayout.top  + cameraViewLayout.height,
      );

      const relLeft = intersectLeft  - cameraViewLayout.left;
      const relTop  = intersectTop   - cameraViewLayout.top;
      const relW    = Math.max(0, intersectRight  - intersectLeft);
      const relH    = Math.max(0, intersectBottom - intersectTop);

      const cropX = relLeft * scaleX;
      const cropY = relTop  * scaleY;
      const cropW = Math.min(relW * scaleX, imageWidth  - cropX);
      const cropH = Math.min(relH * scaleY, imageHeight - cropY);

      corners = {
        topLeft:     { x: cropX,        y: cropY },
        topRight:    { x: cropX + cropW, y: cropY },
        bottomRight: { x: cropX + cropW, y: cropY + cropH },
        bottomLeft:  { x: cropX,        y: cropY + cropH },
      };
    } else {
      // ── Fallback B: recortar el 80 % central con fallbackAspectRatio ───────
      if (onNoDetection === 'throw') {
        throw new Error(
          '[scanDocumentFile] No se detectó ningún documento en la imagen.',
        );
      }

      const cropW = imageWidth * 0.80;
      const cropH = cropW * fallbackAspectRatio;
      const x0    = (imageWidth  - cropW) / 2;
      const y0    = (imageHeight - cropH) / 2;

      corners = {
        topLeft:     { x: x0,         y: y0 },
        topRight:    { x: x0 + cropW, y: y0 },
        bottomRight: { x: x0 + cropW, y: y0 + cropH },
        bottomLeft:  { x: x0,         y: y0 + cropH },
      };
    }
  }

  // ── 4. Forzar apaisado si se pide ─────────────────────────────────────────
  // Usamos la geometría de las esquinas para determinar la orientación del
  // DOCUMENTO (no la orientación del teléfono ni del sensor).
  // takeSnapshot devuelve orientation:"portrait" aunque la imagen sea landscape;
  // por eso ignoramos el campo orientation y comparamos lados del recorte.
  if (forceHorizontal) {
    const docWidth  = euclidean(corners.topLeft, corners.topRight);
    const docHeight = euclidean(corners.topLeft, corners.bottomLeft);
    if (docHeight > docWidth) {
      corners = rotateCW90(corners);
    }
  }

  // ── 5. Aplicar corrección de perspectiva ──────────────────────────────────
  const rawUri = await NativeDocumentScanner.cropAndCorrectPerspective(
    filePath,
    corners.topLeft.x,     corners.topLeft.y,
    corners.topRight.x,    corners.topRight.y,
    corners.bottomRight.x, corners.bottomRight.y,
    corners.bottomLeft.x,  corners.bottomLeft.y,
  );

  const uri = rawUri.startsWith('file://') ? rawUri : `file://${rawUri}`;
  const base64 = await NativeDocumentScanner.readFileAsBase64(
    uri.replace('file://', ''),
  );

  return {
    uri,
    base64,
    originalWidth:  imageWidth,
    originalHeight: imageHeight,
    quality,
  };
}
