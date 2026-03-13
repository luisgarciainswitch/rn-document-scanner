// shared/document_detector.hpp
// Cabecera pública del detector de documentos.
// No incluye ninguna API específica de Android o iOS.
// Importable tanto desde jni_bridge.cpp como desde DocumentScannerModule.mm

#pragma once

#include <opencv2/core.hpp>
#include <vector>
#include <string>

namespace DocumentScanner {

// Información de calidad de la imagen capturada.
// Siempre se rellena tras llamar a detectDocument(), incluso si no se
// detecta ningún documento. Permite al consumidor mostrar advertencias
// sin hacer una segunda llamada al SDK.
struct QualityInfo {
    float blurScore;          // Varianza del Laplaciano — mayor = más nítido
    float brightness;         // Intensidad media de píxeles 0–255
    bool  isBlurry;           // true si la imagen es demasiado borrosa
    bool  isTooDark;          // true si la imagen está demasiado oscura
    bool  isTooLight;         // true si la imagen está sobreexpuesta
    bool  isLikelyDocument;   // true si el cuadrilátero detectado parece un documento
};

// Resultado de una detección de documento.
// corners contiene exactamente 4 puntos si se detectó un documento,
// o está vacío si no se encontró ningún cuadrilátero válido.
struct DetectionResult {
    std::vector<cv::Point2f> corners;  // Orden: TL, TR, BR, BL
    int imageWidth;
    int imageHeight;
    bool detected;
    QualityInfo quality;  // Siempre presente cuando la imagen es legible
};

// Analiza la imagen en la ruta dada y devuelve el resultado de detección.
// La ruta NO debe incluir el prefijo "file://".
DetectionResult detectDocument(const std::string& imagePath);

// Aplica corrección de perspectiva usando los 4 corners detectados.
// corners: vector de exactamente 4 puntos en orden TL, TR, BR, BL.
// outputPath: ruta donde se guarda el resultado (sin prefijo "file://").
// Devuelve true si la corrección fue exitosa.
bool applyPerspectiveCorrection(
    const std::string& inputPath,
    const std::vector<cv::Point2f>& corners,
    const std::string& outputPath
);

} // namespace DocumentScanner
