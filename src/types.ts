// src/types.ts
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

/**
 * Información de calidad de la imagen devuelta junto con cada escaneo.
 * Permite mostrar advertencias al usuario sin hacer llamadas adicionales.
 */
export interface QualityInfo {
  /** Varianza del Laplaciano — mayor valor = imagen más nítida */
  blurScore: number;
  /** Intensidad media de píxeles 0–255 */
  brightness: number;
  /** true si la imagen es demasiado borrosa para un escaneo fiable */
  isBlurry: boolean;
  /** true si la imagen está demasiado oscura */
  isTooDark: boolean;
  /** true si la imagen está sobreexpuesta */
  isTooLight: boolean;
  /** true si el cuadrilátero detectado tiene proporciones y ángulos de documento */
  isLikelyDocument: boolean;
}

export interface ScanResult {
  /** URI de la imagen recortada y con perspectiva corregida (file://...) */
  uri: string;
  /** Imagen recortada codificada en base64 (JPEG, sin prefijo data URI) */
  base64?: string;
  /** Ancho en píxeles de la imagen original capturada */
  originalWidth: number;
  /** Alto en píxeles de la imagen original capturada */
  originalHeight: number;
  /** Información de calidad de la imagen (borrosidad, iluminación, validez) */
  quality?: QualityInfo;
}

export type ScanDocumentInput = string | { base64: string };

/**
 * Posición y tamaño absolutos en pantalla de un componente,
 * tal como los devuelve `ref.current.measure((_x, _y, w, h, left, top) => …)`.
 */
export interface ScreenLayout {
  width: number;
  height: number;
  /** Posición horizontal absoluta respecto al borde izquierdo de la pantalla. */
  left: number;
  /** Posición vertical absoluta respecto al borde superior de la pantalla. */
  top: number;
}

export interface ScanDocumentOptions {
  forceHorizontal?: boolean;
  /**
   * Objeto completo que devuelve VisionCamera en takePhoto() o takeSnapshot().
   * Provee dimensiones y orientación del sensor para mapear correctamente
   * coordenadas de pantalla → píxeles de imagen.
   */
  photo?: {
    width: number;
    height: number;
    orientation: string;
    isMirrored?: boolean;
    isRawPhoto?: boolean;
  };
  /**
   * Layout absoluto en pantalla del **contenedor de la cámara** (el `<View>`
   * que envuelve el componente `<Camera>`), obtenido con `ref.current.measure`.
   *
   * Se usa como denominador de escala pantalla → píxeles sensor:
   * `scaleX = photo.width / cameraViewLayout.width`.
   *
   * Solo se aplica cuando OpenCV **no** detecta ningún documento. Si OpenCV
   * detecta el documento, se usan sus esquinas precisas y este valor se ignora.
   * Debe proporcionarse junto con `guideFrameLayout`.
   */
  cameraViewLayout?: ScreenLayout;
  /**
   * Layout absoluto en pantalla del **rectángulo guía** (el marco visual más
   * pequeño que se muestra al usuario para alinear el documento), obtenido
   * con `ref.current.measure`.
   *
   * Es distinto de `cameraViewLayout`: el guía es un subconjunto del área de
   * cámara. La diferencia de posición (`guideFrameLayout.left - cameraViewLayout.left`)
   * da el offset del guía relativo al sensor, que se escala a píxeles para
   * definir el área de recorte de último recurso.
   *
   * Solo se aplica si OpenCV no detecta ningún documento.
   * Debe proporcionarse junto con `cameraViewLayout`.
   */
  guideFrameLayout?: ScreenLayout;
  /**
   * Relación `alto ÷ ancho` del recorte cuando OpenCV no detecta ningún
   * documento (solo se aplica si `onNoDetection === 'fallback'`).
   *
   * Debe ser un número positivo. Valores comunes:
   * - `1.41`  → A4 / carta en portrait (default)
   * - `1.0`   → cuadrado
   * - `0.71`  → A4 / carta en landscape (= 1 / 1.41)
   * - `0.63`  → tarjeta de crédito en landscape (= 1 / 1.586)
   * - `1.586` → tarjeta de crédito en portrait
   */
  fallbackAspectRatio?: number;
  onNoDetection?: 'fallback' | 'throw';
}

export interface DocumentScannerProps {
  /** Callback cuando el usuario confirma el documento escaneado */
  onCapture: (result: ScanResult) => void;
  /** Callback cuando el usuario cancela el escaneado */
  onCancel: () => void;
  /** Título mostrado en la pantalla de la cámara */
  title?: string;
  /**
   * Relación de aspecto del rectángulo guía.
   * 1.41 ≈ A4/Letter; 1.0 = cuadrado; 1.58 = tarjeta de crédito.
   * Default: 1.41
   */
  frameRatio?: number;
  /**
   * Si es `true`, rota el documento 90° cuando VisionCamera informa que la
   * foto está en orientación portrait, forzando una salida apaisada.
   * Default: false
   */
  forceHorizontal?: boolean;
}
