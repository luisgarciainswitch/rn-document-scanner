# rn-document-scanner

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![React Native](https://img.shields.io/badge/React%20Native-%3E%3D0.80-green)](https://reactnative.dev)
[![Platform Android](https://img.shields.io/badge/Android-API%2023%2B-brightgreen)](https://developer.android.com)
[![Platform iOS](https://img.shields.io/badge/iOS-13%2B-lightgrey)](https://developer.apple.com)

Escáner automático de documentos para React Native construido sobre **VisionCamera v4** y **OpenCV 4.10.0**. Abre la cámara trasera, detecta el borde del documento en C++ nativo, aplica corrección de perspectiva y devuelve la imagen recortada como URI local (o base64 opcional).

---

## Tabla de contenidos

- [Compatibilidad](#compatibilidad)
- [Características estables](#características-estables)
- [Roadmap (futuras features)](#roadmap-futuras-features)
- [Instalación](#instalación)
  - [Desde GitHub Packages](#desde-github-packages)
  - [Dependencias peer](#dependencias-peer)
  - [Configuración Android](#configuración-android)
  - [Configuración iOS](#configuración-ios)
- [Uso](#uso)
  - [Componente DocumentScanner](#componente-documentscanner)
  - [Función scanDocumentFile](#función-scandocumentfile)
- [API Reference](#api-reference)
  - [DocumentScannerProps](#documentscannerprops)
  - [ScanResult](#scanresult)
  - [QualityInfo](#qualityinfo)
  - [ScanDocumentOptions](#scandocumentoptions)
- [Arquitectura](#arquitectura)
- [Rendimiento](#rendimiento)
- [Licencia](#licencia)

---

## Compatibilidad

| Plataforma    | Versión mínima              | Arquitecturas                        |
|---------------|-----------------------------|--------------------------------------|
| Android       | API 23 (Android 6.0)        | `arm64-v8a`, `x86_64` (emulador)     |
| iOS           | 13.0 (iPhone 6s)            | `arm64` (device), `x86_64` (sim Intel) |
| React Native  | 0.80+ (New Architecture)    | TurboModules + Interop Layer         |
| OpenCV        | 4.10.0+                     | —                                    |

> **Nota:** OpenCV < 4.10.0 puede causar crashes en Android 15 / iOS con páginas de memoria de 16 KB (Pixel 9 y hardware equivalente).

---

## Características estables

### Detección de documentos
- **Detección de bordes en tiempo real** vía OpenCV (algoritmo Canny + transformada de Hough) ejecutado en C++ nativo.
- **Corrección de perspectiva automática** — el cuadrilátero detectado se rectifica a un rectángulo con warpPerspective.
- **Tolerancia a temblores** — requiere `N` fotogramas consecutivos estables antes de disparar la captura (configurable por tier de dispositivo).
- **Fallback inteligente**: si OpenCV no detecta ningún documento, recorta en base al rectángulo guía visible en pantalla.

### Captura y calidad
- **Doble captura** — snapshot de baja latencia para análisis + foto de calidad para el resultado final.
- **Análisis de calidad de imagen** incluido en el resultado:
  - Puntuación de borrosidad (varianza del Laplaciano).
  - Evaluación de brillo (demasiado oscuro / sobreexpuesto).
  - Flag `isLikelyDocument` que indica si el cuadrilátero tiene proporciones realistas.
- **Base64 opcional** — el resultado puede incluir la imagen codificada en base64 sin llamadas adicionales.

### UX y flujo de usuario
- **Estados visuales claros**: searching → detected → stabilizing → capturing → processing → preview.
- **Preview de confirmación** — el usuario ve el resultado y puede repetir el escaneo o confirmarlo.
- **Hints adaptativos** — mensaje contextual en cada state del ciclo de escaneo.
- **Compatibilidad MIUI/HyperOS** — manejo del bug de pantalla negra al volver de background.
- **Ratio de encuadre configurable** (`frameRatio`): A4/Letter (1.41), cuadrado (1.0), tarjeta de crédito (1.586), landscape (0.71), etc.
- **Modo landscape forzado** (`forceHorizontal`) — rota la salida 90° cuando el sensor reporta portrait.

### Configuración adaptativa por dispositivo
- Detección automática del tier del dispositivo (bajo/medio/alto).
- Intervalo de análisis y delay de estabilidad ajustados según el tier.

### Interoperabilidad
- Compatible con **New Architecture** (TurboModules) y modo de compatibilidad (Interop Layer).
- Autolinking nativo completo en Android y iOS.
- Peer dependencies: `react-native-vision-camera ^4.5.0`, `react-native-device-info ^11.0.0`.

---

## Roadmap (futuras features)

Las siguientes funcionalidades están planificadas para versiones futuras. El orden es indicativo, no garantizado.

| Feature | Descripción | versión estimada |
|---------|-------------|-----------------|
| **Multi-page scan** | Captura múltiples páginas en una misma sesión y devuelve un array de `ScanResult`. | v1.1 |
| **PDF export** | Exporta las páginas escaneadas directamente a PDF sin dependencias externas. | v1.1 |
| **HEIC/WebP output** | Opción para devolver la imagen en HEIC (iOS) o WebP (Android) además de JPEG. | v1.1 |
| **Manual corner adjustment** | UI de ajuste manual de las 4 esquinas detectadas antes de confirmar. | v1.2 |
| **Flash automático** | Activación automática del flash cuando `isTooDark === true`. | v1.2 |
| **Modo galería** | `scanDocumentFile` con soporte para múltiples imágenes en batch. | v1.2 |
| **Denoising** | Filtro de reducción de ruido (fastNlMeans) para capturas en condiciones de poca luz. | v1.3 |
| **Binarización adaptativa** | Modo blanco y negro con umbral adaptativo para documentos de texto. | v1.3 |
| **Frame processors JSI** | Opción opt-in para detección en frame processor (más baja latencia) una vez que el ecosistema Reanimated+worklets sea estable. | v2.0 |
| **macOS Catalyst** | Soporte para apps RN en macOS. | v2.0 |

> ¿Tienes una feature en mente que no aparece aquí? Abre un issue en el repositorio.

---

## Instalación

### Desde GitHub Packages

El paquete se publica en el registro npm de GitHub Packages bajo el scope `@luisgarcia`. Para instalarlo necesitas autenticarte:

**1. Crear un Personal Access Token (PAT)**

Ve a GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) y genera un token con los scopes `read:packages`.

**2. Autenticar el scope en tu proyecto**

Crea o edita el archivo `.npmrc` en la raíz del proyecto host:

```
@luisgarcia:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TU_GITHUB_PAT
```

> Nunca comitees el token directamente. Usa una variable de entorno:
> ```
> //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
> ```
> y define `GITHUB_TOKEN` en tu entorno local o CI/CD.

**3. Instalar el paquete**

```bash
npm install @luisgarcia/rn-document-scanner
# o con yarn
yarn add @luisgarcia/rn-document-scanner
```

---

### Dependencias peer

Instala estas dependencias en el proyecto host si aún no las tienes:

```bash
npm install react-native-vision-camera@^4.5.0
npm install react-native-device-info@^11.0.0
```

---

### Configuración Android

**android/build.gradle** — añade `mavenCentral()` en el bloque `allprojects.repositories`:

```groovy
allprojects {
  repositories {
    mavenCentral()   // requerido para OpenCV 4.10.0
    google()
  }
}
```

**android/gradle.properties** — verifica SDK mínimo y New Architecture:

```properties
minSdkVersion=23
newArchEnabled=true
```

**android/app/src/main/AndroidManifest.xml** — permiso de cámara:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Limpia la build para evitar caché de Gradle obsoleta:

```bash
cd android && ./gradlew clean && cd ..
```

---

### Configuración iOS

Instala los pods (la primera ejecución descarga OpenCV2 ~300 MB que queda en caché):

```bash
cd ios && pod install && cd ..
```

**ios/TuApp/Info.plist** — descripción de uso de cámara (obligatorio en iOS):

```xml
<key>NSCameraUsageDescription</key>
<string>Necesitamos acceso a la cámara para escanear documentos.</string>
```

---

## Uso

### Componente DocumentScanner

El componente ocupa toda la pantalla y gestiona el ciclo completo de escaneo.

```typescript
import React, { useState } from 'react';
import { Button, Image, View, StyleSheet } from 'react-native';
import { DocumentScanner, type ScanResult } from '@luisgarcia/rn-document-scanner';

export default function ScanScreen() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  if (scanning) {
    return (
      <DocumentScanner
        title="Escanear documento"
        frameRatio={1.41}
        onCapture={(scanResult: ScanResult) => {
          setResult(scanResult);
          setScanning(false);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      {result && (
        <>
          <Image source={{ uri: result.uri }} style={styles.preview} />
          {result.quality?.isBlurry && <Text>⚠️ Imagen borrosa</Text>}
          {result.quality?.isTooDark && <Text>⚠️ Poca luz</Text>}
        </>
      )}
      <Button title="Escanear" onPress={() => setScanning(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview:   { width: 300, height: 424, resizeMode: 'contain' },
});
```

---

### Función scanDocumentFile

Escanea una imagen ya existente (desde galería u otra fuente) sin necesidad de abrir la cámara.

```typescript
import { scanDocumentFile, type ScanResult } from '@luisgarcia/rn-document-scanner';

async function processImage(imageUri: string): Promise<void> {
  const result: ScanResult = await scanDocumentFile(imageUri, {
    fallbackAspectRatio: 1.41,
    onNoDetection: 'fallback',
  });

  console.log('URI procesada:', result.uri);
  console.log('Calidad:', result.quality);
}
```

---

## API Reference

### DocumentScannerProps

| Prop | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `onCapture` | `(result: ScanResult) => void` | — | **Requerido.** Callback cuando el usuario confirma el documento escaneado. |
| `onCancel` | `() => void` | — | **Requerido.** Callback cuando el usuario cancela. |
| `title` | `string` | `undefined` | Título mostrado en la pantalla de la cámara. |
| `frameRatio` | `number` | `1.41` | Relación de aspecto `alto ÷ ancho` del rectángulo guía. `1.41` = A4/Letter, `1.0` = cuadrado, `1.586` = tarjeta crédito. |
| `forceHorizontal` | `boolean` | `false` | Si `true`, rota el resultado 90° cuando el sensor reporta orientación portrait, forzando salida apaisada. |

---

### ScanResult

```typescript
interface ScanResult {
  uri:             string;       // URI local de la imagen procesada (file://...)
  base64?:         string;       // JPEG en base64 sin prefijo data URI (opcional)
  originalWidth:   number;       // Ancho en px de la foto original
  originalHeight:  number;       // Alto en px de la foto original
  quality?:        QualityInfo;  // Métricas de calidad de la imagen
}
```

---

### QualityInfo

```typescript
interface QualityInfo {
  blurScore:        number;   // Varianza del Laplaciano — mayor = más nítido
  brightness:       number;   // Intensidad media de píxeles (0–255)
  isBlurry:         boolean;  // true si la imagen es demasiado borrosa
  isTooDark:        boolean;  // true si la imagen está subexpuesta
  isTooLight:       boolean;  // true si la imagen está sobreexpuesta
  isLikelyDocument: boolean;  // true si el cuadrilátero tiene proporciones de documento
}
```

---

### ScanDocumentOptions

Opciones para `scanDocumentFile()`:

```typescript
interface ScanDocumentOptions {
  forceHorizontal?:    boolean;         // Igual que en DocumentScannerProps
  fallbackAspectRatio?: number;         // Ratio de recorte si no se detecta documento
  onNoDetection?:      'fallback' | 'throw';  // Comportamiento sin detección
  photo?: {
    width: number; height: number;
    orientation: string; isMirrored?: boolean;
  };
  cameraViewLayout?:  ScreenLayout;    // Layout del contenedor de cámara
  guideFrameLayout?:  ScreenLayout;    // Layout del rectángulo guía
}
```

---

### DocumentCorners / Point

```typescript
interface Point { x: number; y: number; }

interface DocumentCorners {
  topLeft:     Point;
  topRight:    Point;
  bottomRight: Point;
  bottomLeft:  Point;
}
```

---

## Arquitectura

El paquete sigue una arquitectura de **tres capas**:

```
TypeScript (React + Hooks)
        ↓   TurboModule / JSI
Kotlin / Objective-C++ bridge
        ↓   JNI / Objective-C++
C++ compartido (shared/document_detector.cpp)
        ↓
OpenCV 4.10.0
```

- **`shared/document_detector.cpp`** — lógica de detección y corrección de perspectiva, compilada una sola vez para Android (CMake) e iOS (podspec xcconfig).
- **Ciclo de análisis periódico** — usa `setInterval + takePhoto('speed')` en lugar de frame processors JSI para evitar colisiones de runtime entre Reanimated y worklets-core.
- **Detección de tier de dispositivo** (`deviceTier.ts`) — ajusta el intervalo de análisis y el delay de estabilidad según las capacidades del hardware.

---

## Rendimiento

| Métrica | Gama alta | Gama media | Gama baja |
|---------|-----------|------------|-----------|
| Intervalo de análisis | 600 ms | 800 ms | 1200 ms |
| Delay de estabilidad | 500 ms | 700 ms | 1000 ms |
| Tiempo de corrección de perspectiva (C++) | ~30 ms | ~60 ms | ~120 ms |

> La latencia perceptible desde que el usuario alinea el documento hasta que se dispara la captura es de 1–2 s en todo el rango de hardware soportado.

---

## Licencia

MIT © Luis Garcia — ver el archivo [LICENSE](../LICENSE) para el texto completo.
