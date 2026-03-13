// shared/document_detector.cpp
// Implementación del detector de documentos con OpenCV 4.10.0.
// Funciona en Android (compilado por CMake) e iOS (compilado por Xcode via CocoaPods).

#include "document_detector.hpp"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <algorithm>
#include <cmath>
#include <numeric>

namespace DocumentScanner {

// ─── Utilidades internas ──────────────────────────────────────────────────────

// Calcula la mediana de un vector de valores de píxel.
static double medianValue(const cv::Mat& grayImage) {
    std::vector<uchar> pixels;
    pixels.reserve(grayImage.total());
    if (grayImage.isContinuous()) {
        pixels.assign(grayImage.data, grayImage.data + grayImage.total());
    } else {
        for (int r = 0; r < grayImage.rows; ++r) {
            const uchar* row = grayImage.ptr<uchar>(r);
            pixels.insert(pixels.end(), row, row + grayImage.cols);
        }
    }
    std::nth_element(pixels.begin(), pixels.begin() + pixels.size() / 2, pixels.end());
    return static_cast<double>(pixels[pixels.size() / 2]);
}

// Calcula la distancia euclidiana entre dos puntos.
static double pointDist(const cv::Point2f& a, const cv::Point2f& b) {
    float dx = a.x - b.x;
    float dy = a.y - b.y;
    return std::sqrt(dx * dx + dy * dy);
}

// Ordena 4 puntos en orden TL, TR, BR, BL.
static std::vector<cv::Point2f> orderPoints(const std::vector<cv::Point2f>& pts) {
    std::vector<cv::Point2f> ordered(4);

    std::vector<float> sums(4), diffs(4);
    for (int i = 0; i < 4; ++i) {
        sums[i]  = pts[i].x + pts[i].y;
        diffs[i] = pts[i].y - pts[i].x;
    }

    ordered[0] = pts[std::min_element(sums.begin(),  sums.end())  - sums.begin()];
    ordered[2] = pts[std::max_element(sums.begin(),  sums.end())  - sums.begin()];
    ordered[1] = pts[std::min_element(diffs.begin(), diffs.end()) - diffs.begin()];
    ordered[3] = pts[std::max_element(diffs.begin(), diffs.end()) - diffs.begin()];

    return ordered;
}

// ─── Extracción de cuadrilátero desde un contorno ────────────────────────────

// Intenta obtener un cuadrilátero convexo a partir de un contorno.
// Prueba primero la aproximación directa con varios epsilon; si falla, usa
// la envoltura convexa (convex hull) para absorber irregularidades debidas
// a dedos u oclusiones parciales del documento.
static bool tryExtractQuad(
    const std::vector<cv::Point>& contour,
    double scale,
    int origW,
    int origH,
    std::vector<cv::Point2f>& outCorners
) {
    auto buildCorners = [&](const std::vector<cv::Point>& approx) -> bool {
        if (approx.size() != 4 || !cv::isContourConvex(approx)) return false;
        std::vector<cv::Point2f> pts;
        pts.reserve(4);
        for (const auto& p : approx) {
            pts.emplace_back(
                std::max(0.0f, std::min(p.x / static_cast<float>(scale), static_cast<float>(origW - 1))),
                std::max(0.0f, std::min(p.y / static_cast<float>(scale), static_cast<float>(origH - 1)))
            );
        }
        outCorners = orderPoints(pts);
        return true;
    };

    // 1. Aproximación directa con múltiples valores de epsilon
    double perimeter = cv::arcLength(contour, true);
    for (double eps : {0.020, 0.015, 0.025, 0.030}) {
        std::vector<cv::Point> approx;
        cv::approxPolyDP(contour, approx, eps * perimeter, true);
        if (buildCorners(approx)) return true;
    }

    // 2. Envoltura convexa + aproximación: tolera dedos y bordes parcialmente
    //    ocluidos que rompen la forma rectangular del contorno original.
    std::vector<cv::Point> hull;
    cv::convexHull(contour, hull);
    double hullPerim = cv::arcLength(hull, true);
    for (double eps : {0.020, 0.030, 0.040, 0.050}) {
        std::vector<cv::Point> approx;
        cv::approxPolyDP(hull, approx, eps * hullPerim, true);
        if (buildCorners(approx)) return true;
    }

    return false;
}

// ─── Análisis de calidad de imagen ──────────────────────────────────────────

// Evalúa borrosidad, iluminación y si el cuadrilátero detectado parece un documento.
// Trabaja sobre una versión reducida al 50 % para mayor velocidad.
static QualityInfo analyzeQuality(
    const cv::Mat& original,
    bool detected,
    const std::vector<cv::Point2f>& corners
) {
    QualityInfo q = {};

    cv::Mat small;
    cv::resize(original, small, cv::Size(), 0.5, 0.5, cv::INTER_AREA);
    cv::Mat gray;
    cv::cvtColor(small, gray, cv::COLOR_BGR2GRAY);

    // ── Borrosidad: varianza del Laplaciano ──────────────────────────────────
    // Si se detectó documento, analizar solo el área de la región detectada.
    cv::Mat roi;
    if (detected && corners.size() == 4) {
        const float s = 0.5f;
        float minX = std::min({corners[0].x, corners[1].x, corners[2].x, corners[3].x}) * s;
        float minY = std::min({corners[0].y, corners[1].y, corners[2].y, corners[3].y}) * s;
        float maxX = std::max({corners[0].x, corners[1].x, corners[2].x, corners[3].x}) * s;
        float maxY = std::max({corners[0].y, corners[1].y, corners[2].y, corners[3].y}) * s;
        minX = std::max(0.0f, minX);
        minY = std::max(0.0f, minY);
        maxX = std::min(static_cast<float>(gray.cols - 1), maxX);
        maxY = std::min(static_cast<float>(gray.rows - 1), maxY);
        int rw = static_cast<int>(maxX - minX);
        int rh = static_cast<int>(maxY - minY);
        if (rw > 4 && rh > 4)
            roi = gray(cv::Rect(static_cast<int>(minX), static_cast<int>(minY), rw, rh));
    }
    if (roi.empty()) roi = gray;

    cv::Mat lap;
    cv::Laplacian(roi, lap, CV_64F);
    cv::Scalar lMean, lStd;
    cv::meanStdDev(lap, lMean, lStd);
    q.blurScore = static_cast<float>(lStd[0] * lStd[0]);  // varianza
    q.isBlurry  = q.blurScore < 100.0f;

    // ── Iluminación: media de la escala de grises ────────────────────────────
    cv::Scalar bMean = cv::mean(gray);
    q.brightness = static_cast<float>(bMean[0]);
    q.isTooDark  = q.brightness < 40.0f;
    q.isTooLight = q.brightness > 220.0f;

    // ── ¿Parece un documento? ────────────────────────────────────────────────
    if (detected && corners.size() == 4) {
        // Relación de aspecto del documento detectado
        double docW = pointDist(corners[0], corners[1]);  // TL → TR
        double docH = pointDist(corners[0], corners[3]);  // TL → BL
        if (docH < 1.0) docH = 1.0;
        bool goodRatio = (docW / docH > 0.2 && docW / docH < 5.0);

        // Los 4 ángulos deben estar dentro de ±30° de 90°
        auto innerAngle = [](const cv::Point2f& o,
                              const cv::Point2f& a,
                              const cv::Point2f& b) -> double {
            cv::Point2f v1 = a - o, v2 = b - o;
            double l1 = std::sqrt(v1.x*v1.x + v1.y*v1.y);
            double l2 = std::sqrt(v2.x*v2.x + v2.y*v2.y);
            if (l1 < 1.0 || l2 < 1.0) return 0.0;
            double cosT = std::max(-1.0, std::min(1.0,
                (v1.x*v2.x + v1.y*v2.y) / (l1 * l2)));
            return std::acos(cosT) * 180.0 / 3.14159265358979323846;
        };
        // corners: [0]=TL, [1]=TR, [2]=BR, [3]=BL
        bool goodAngles =
            std::abs(innerAngle(corners[0], corners[1], corners[3]) - 90.0) < 30.0 &&
            std::abs(innerAngle(corners[1], corners[2], corners[0]) - 90.0) < 30.0 &&
            std::abs(innerAngle(corners[2], corners[3], corners[1]) - 90.0) < 30.0 &&
            std::abs(innerAngle(corners[3], corners[0], corners[2]) - 90.0) < 30.0;

        // Área del cuadrilátero (fórmula del cordón de zapato) ≥ 3 % del imagen
        double quadArea = 0.5 * std::abs(
            (corners[0].x*(corners[1].y - corners[3].y)) +
            (corners[1].x*(corners[2].y - corners[0].y)) +
            (corners[2].x*(corners[3].y - corners[1].y)) +
            (corners[3].x*(corners[0].y - corners[2].y))
        );
        bool goodArea = quadArea >= static_cast<double>(original.cols * original.rows) * 0.03;

        q.isLikelyDocument = goodRatio && goodAngles && goodArea;
    } else {
        q.isLikelyDocument = false;
    }

    return q;
}

// ─── Detección de documento ───────────────────────────────────────────────────

DetectionResult detectDocument(const std::string& imagePath) {
    DetectionResult result;
    result.detected = false;

    cv::Mat original = cv::imread(imagePath);
    if (original.empty()) {
        return result;
    }

    result.imageWidth  = original.cols;
    result.imageHeight = original.rows;

    // Múltiples pasadas con distintas combinaciones de escala, sigma y dilación.
    // Esto permite detectar documentos en condiciones difíciles (tarjetas
    // sostenidas con la mano, fondos claros, baja luminosidad, etc.).
    struct Pass { double scale; double sigma; int dilation; };
    static const Pass passes[] = {
        {0.50, 0.33, 2},   // pass estándar rápida
        {0.50, 0.20, 3},   // umbrales más bajos + más dilación
        {0.50, 0.45, 2},   // umbrales más altos (escenas con mucho contraste)
        {0.75, 0.33, 2},   // escala mayor: preserva más detalle de borde
        {0.75, 0.20, 3},   // escala mayor + umbrales bajos (documentos claros)
    };

    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_RECT, cv::Size(3, 3));

    for (const auto& pass : passes) {
        cv::Mat small;
        cv::resize(original, small, cv::Size(), pass.scale, pass.scale, cv::INTER_AREA);

        cv::Mat gray;
        cv::cvtColor(small, gray, cv::COLOR_BGR2GRAY);
        cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);

        // CLAHE: mejora el contraste local antes de Canny.
        // Clave para tarjetas blancas sobre fondo claro donde la diferencia
        // de intensidad en los bordes es pequeña.
        cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(2.0, cv::Size(8, 8));
        clahe->apply(gray, gray);

        // Umbrales adaptativos basados en la mediana (post-CLAHE la distribución
        // es más uniforme, lo que estabiliza los umbrales).
        double med   = medianValue(gray);
        double lower = std::max(0.0,   (1.0 - pass.sigma) * med);
        double upper = std::min(255.0, (1.0 + pass.sigma) * med);

        cv::Mat edges;
        cv::Canny(gray, edges, lower, upper);
        cv::dilate(edges, edges, kernel, cv::Point(-1, -1), pass.dilation);

        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(edges, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

        std::sort(contours.begin(), contours.end(),
            [](const std::vector<cv::Point>& a, const std::vector<cv::Point>& b) {
                return cv::contourArea(a) > cv::contourArea(b);
            });

        double smallArea = static_cast<double>(small.cols * small.rows);

        int tried = 0;
        for (const auto& contour : contours) {
            double area = cv::contourArea(contour);
            if (area < smallArea * 0.10 || area > smallArea * 0.98) continue;
            if (++tried > 5) break;  // máximo 5 contornos candidatos por pasada

            std::vector<cv::Point2f> corners;
            if (tryExtractQuad(contour, pass.scale, result.imageWidth, result.imageHeight, corners)) {
                result.corners  = corners;
                result.detected = true;
                result.quality  = analyzeQuality(original, true, corners);
                return result;
            }
        }
    }

    result.quality = analyzeQuality(original, false, {});
    return result;
}

// ─── Corrección de perspectiva ────────────────────────────────────────────────

bool applyPerspectiveCorrection(
    const std::string& inputPath,
    const std::vector<cv::Point2f>& corners,
    const std::string& outputPath
) {
    if (corners.size() != 4) return false;

    cv::Mat src = cv::imread(inputPath);
    if (src.empty()) return false;

    // Acotar esquinas a los límites de la imagen para evitar franjas negras
    // que warpPerspective produce cuando las coordenadas salen fuera del frame.
    std::vector<cv::Point2f> c(corners.begin(), corners.end());
    const float maxX = static_cast<float>(src.cols - 1);
    const float maxY = static_cast<float>(src.rows - 1);
    for (auto& pt : c) {
        pt.x = std::max(0.0f, std::min(pt.x, maxX));
        pt.y = std::max(0.0f, std::min(pt.y, maxY));
    }

    // Expandir cada esquina hacia afuera del centroide del cuadrilátero.
    // El padding es proporcional a la diagonal del documento detectado (1.5 %)
    // para adaptarse a cualquier resolución: en una foto de 4032 px el padding
    // será ~60 px, mientras que en una imagen de 1280 px será ~19 px.
    // Esto evita que el OCR posterior descarte el documento por bordes cortados.
    {
        const double docDiag = pointDist(c[0], c[2]);  // TL → BR
        const float  PADDING = static_cast<float>(docDiag * 0.015);

        cv::Point2f centroid(0.0f, 0.0f);
        for (const auto& pt : c) centroid += pt;
        centroid /= 4.0f;
        for (auto& pt : c) {
            cv::Point2f dir = pt - centroid;
            const float len = std::sqrt(dir.x * dir.x + dir.y * dir.y);
            if (len > 0.0f) pt += (PADDING / len) * dir;
            pt.x = std::max(0.0f, std::min(pt.x, maxX));
            pt.y = std::max(0.0f, std::min(pt.y, maxY));
        }
    }

    const cv::Point2f& tl = c[0];
    const cv::Point2f& tr = c[1];
    const cv::Point2f& br = c[2];
    const cv::Point2f& bl = c[3];

    double widthTop    = pointDist(tl, tr);
    double widthBottom = pointDist(bl, br);
    int maxWidth       = static_cast<int>(std::max(widthTop, widthBottom));

    double heightLeft  = pointDist(tl, bl);
    double heightRight = pointDist(tr, br);
    int maxHeight      = static_cast<int>(std::max(heightLeft, heightRight));

    // Guard: degenerate geometry would crash warpPerspective with a Size(0,0).
    if (maxWidth <= 0 || maxHeight <= 0) return false;

    std::vector<cv::Point2f> dst = {
        {0.0f,                    0.0f},
        {static_cast<float>(maxWidth - 1), 0.0f},
        {static_cast<float>(maxWidth - 1), static_cast<float>(maxHeight - 1)},
        {0.0f,                    static_cast<float>(maxHeight - 1)}
    };

    cv::Mat M = cv::getPerspectiveTransform(c, dst);
    cv::Mat warped;
    cv::warpPerspective(src, warped, M, cv::Size(maxWidth, maxHeight), cv::INTER_CUBIC);

    // ── Corrección de orientación: garantizar que el documento quede boca arriba ──
    // orderPoints asigna TL geométricamente (menor x+y), pero si el usuario
    // sostuvo el documento boca abajo el TL geométrico cae en la mitad inferior
    // de la imagen → el warp resultante sale invertido.
    // Heurística: si el TL (c[0]) está por debajo del centro vertical de la
    // imagen original, el documento fue capturado boca abajo → rotar 180°.
    {
        const float imageCenterY = static_cast<float>(src.rows) * 0.5f;
        if (c[0].y > imageCenterY) {
            cv::rotate(warped, warped, cv::ROTATE_180);
        }
    }

    std::vector<int> params = {cv::IMWRITE_JPEG_QUALITY, 92};
    return cv::imwrite(outputPath, warped, params);
}

} // namespace DocumentScanner
