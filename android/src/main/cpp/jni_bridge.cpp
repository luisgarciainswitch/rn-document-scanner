// android/src/main/cpp/jni_bridge.cpp
// Puente JNI entre Kotlin y el código C++ compartido.

#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include "document_detector.hpp"

#define LOG_TAG "RNDocumentScanner"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

extern "C" {

JNIEXPORT jfloatArray JNICALL
Java_com_rndocumentscanner_DocumentScannerModule_nativeDetectDocument(
    JNIEnv* env,
    jobject /* thiz */,
    jstring imagePath
) {
    const char* path = env->GetStringUTFChars(imagePath, nullptr);
    if (!path) return nullptr;

    std::string pathStr(path);
    env->ReleaseStringUTFChars(imagePath, path);

    DocumentScanner::DetectionResult result;
    try {
        result = DocumentScanner::detectDocument(pathStr);
    } catch (const std::exception&) {
        LOGE("detectDocument: image processing error");
        return nullptr;
    }

    // If the image could not be read at all, return null.
    if (result.imageWidth == 0 || result.imageHeight == 0) {
        return nullptr;
    }

    // Always return a full array so the caller gets quality info even when no
    // document is detected.
    // Format (17 floats):
    //   [0]    isDetected (0/1)
    //   [1..8] corners x0,y0,x1,y1,x2,y2,x3,y3  (zeroed when not detected)
    //   [9]    imageWidth
    //   [10]   imageHeight
    //   [11]   blurScore
    //   [12]   brightness
    //   [13]   isBlurry (0/1)
    //   [14]   isTooDark (0/1)
    //   [15]   isTooLight (0/1)
    //   [16]   isLikelyDocument (0/1)
    jfloat buf[17] = {};
    buf[0] = result.detected ? 1.0f : 0.0f;
    if (result.detected && result.corners.size() == 4) {
        for (int i = 0; i < 4; ++i) {
            buf[1 + i * 2]     = result.corners[i].x;
            buf[1 + i * 2 + 1] = result.corners[i].y;
        }
    }
    buf[9]  = static_cast<jfloat>(result.imageWidth);
    buf[10] = static_cast<jfloat>(result.imageHeight);
    buf[11] = result.quality.blurScore;
    buf[12] = result.quality.brightness;
    buf[13] = result.quality.isBlurry         ? 1.0f : 0.0f;
    buf[14] = result.quality.isTooDark        ? 1.0f : 0.0f;
    buf[15] = result.quality.isTooLight       ? 1.0f : 0.0f;
    buf[16] = result.quality.isLikelyDocument ? 1.0f : 0.0f;

    jfloatArray arr = env->NewFloatArray(17);
    env->SetFloatArrayRegion(arr, 0, 17, buf);
    return arr;
}

JNIEXPORT jboolean JNICALL
Java_com_rndocumentscanner_DocumentScannerModule_nativeApplyPerspectiveCorrection(
    JNIEnv* env,
    jobject /* thiz */,
    jstring inputPath,
    jfloat x0, jfloat y0,
    jfloat x1, jfloat y1,
    jfloat x2, jfloat y2,
    jfloat x3, jfloat y3,
    jstring outputPath
) {
    const char* inPath  = env->GetStringUTFChars(inputPath,  nullptr);
    const char* outPath = env->GetStringUTFChars(outputPath, nullptr);
    if (!inPath || !outPath) return JNI_FALSE;

    std::string inStr(inPath), outStr(outPath);
    env->ReleaseStringUTFChars(inputPath,  inPath);
    env->ReleaseStringUTFChars(outputPath, outPath);

    std::vector<cv::Point2f> corners = {
        {x0, y0}, {x1, y1}, {x2, y2}, {x3, y3}
    };

    bool ok = false;
    try {
        ok = DocumentScanner::applyPerspectiveCorrection(inStr, corners, outStr);
    } catch (const std::exception& e) {
        LOGE("applyPerspectiveCorrection exception: %s", e.what());
    }

    return ok ? JNI_TRUE : JNI_FALSE;
}

} // extern "C"
