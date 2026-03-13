// src/NativeDocumentScanner.ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Point {
  x: number;
  y: number;
}

export interface DocumentCorners {
  topLeft:     Point;
  topRight:    Point;
  bottomRight: Point;
  bottomLeft:  Point;
}

export interface QualityInfo {
  blurScore:        number;
  brightness:       number;
  isBlurry:         boolean;
  isTooDark:        boolean;
  isTooLight:       boolean;
  isLikelyDocument: boolean;
}

export interface DetectionResult {
  /** null when no document was detected (but image was readable) */
  corners:     DocumentCorners | null;
  imageWidth:  number;
  imageHeight: number;
  quality:     QualityInfo;
}

export interface Spec extends TurboModule {
  detectDocumentInImage(filePath: string): Promise<DetectionResult | null>;

  cropAndCorrectPerspective(
    filePath: string,
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
  ): Promise<string>;

  /**
   * Lee un archivo de imagen y lo devuelve como cadena base64 sin encabezado
   * data URI. Útil para incluir el resultado del escaneo directamente en la
   * respuesta sin que el consumidor tenga que leer el archivo por su cuenta.
   */
  readFileAsBase64(filePath: string): Promise<string>;

  /**
   * Decodifica una cadena base64 (JPEG/PNG) y la guarda en un archivo
   * temporal, devolviendo su ruta como `file://...`.
   * Útil para la API headless `scanDocumentFile({ base64 })`.
   */
  saveBase64ImageToTemp(base64: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentScanner');
