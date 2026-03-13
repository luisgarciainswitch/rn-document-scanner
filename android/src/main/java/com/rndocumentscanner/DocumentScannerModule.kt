// DocumentScannerModule.kt
package com.rndocumentscanner

import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import java.io.File
import java.io.IOException

class DocumentScannerModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    companion object {
        init {
            // libopencv_java4.so is loaded automatically as a transitive
            // dependency of document_scanner — no explicit call needed.
            System.loadLibrary("document_scanner")
        }
    }

    override fun getName(): String = "DocumentScanner"

    // ─── Funciones nativas (implementadas en jni_bridge.cpp) ──────────────────

    private external fun nativeDetectDocument(imagePath: String): FloatArray?

    private external fun nativeApplyPerspectiveCorrection(
        inputPath: String,
        x0: Float, y0: Float,
        x1: Float, y1: Float,
        x2: Float, y2: Float,
        x3: Float, y3: Float,
        outputPath: String
    ): Boolean

    // ─── Corrección de orientación EXIF ──────────────────────────────────────
    // Algunos dispositivos Samsung guardan la foto con rotación EXIF.
    // OpenCV no respeta EXIF → se corrige antes del análisis.
    private fun correctOrientation(filePath: String): String {
        val cleanPath = filePath.removePrefix("file://")

        val exif = try {
            ExifInterface(cleanPath)
        } catch (e: IOException) {
            return cleanPath
        }

        val orientation = exif.getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL
        )

        if (orientation == ExifInterface.ORIENTATION_NORMAL ||
            orientation == ExifInterface.ORIENTATION_UNDEFINED) {
            return cleanPath
        }

        val bitmap = android.graphics.BitmapFactory.decodeFile(cleanPath) ?: return cleanPath

        val matrix = android.graphics.Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90  -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL   -> matrix.postScale(1f, -1f)
            else -> return cleanPath
        }

        val rotated = android.graphics.Bitmap.createBitmap(
            bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true
        )

        val correctedFile = File(cleanPath)
        correctedFile.outputStream().use { out ->
            rotated.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, out)
        }

        bitmap.recycle()
        rotated.recycle()

        return cleanPath
    }

    // ─── Métodos exportados a React Native ────────────────────────────────────

    @ReactMethod
    fun detectDocumentInImage(filePath: String, promise: Promise) {
        try {
            val correctedPath = correctOrientation(filePath)
            val floats = nativeDetectDocument(correctedPath)

            // null = image could not be read by OpenCV at all
            if (floats == null || floats.size < 17) {
                promise.resolve(null)
                return
            }

            val isDetected = floats[0].toInt() == 1

            val quality = Arguments.createMap().apply {
                putDouble("blurScore",         floats[11].toDouble())
                putDouble("brightness",        floats[12].toDouble())
                putBoolean("isBlurry",         floats[13].toInt() == 1)
                putBoolean("isTooDark",        floats[14].toInt() == 1)
                putBoolean("isTooLight",       floats[15].toInt() == 1)
                putBoolean("isLikelyDocument", floats[16].toInt() == 1)
            }

            val result = Arguments.createMap().apply {
                putInt("imageWidth",  floats[9].toInt())
                putInt("imageHeight", floats[10].toInt())
                putMap("quality", quality)
            }

            if (isDetected) {
                val corners = Arguments.createMap().apply {
                    putMap("topLeft",     Arguments.createMap().apply { putDouble("x", floats[1].toDouble()); putDouble("y", floats[2].toDouble()) })
                    putMap("topRight",    Arguments.createMap().apply { putDouble("x", floats[3].toDouble()); putDouble("y", floats[4].toDouble()) })
                    putMap("bottomRight", Arguments.createMap().apply { putDouble("x", floats[5].toDouble()); putDouble("y", floats[6].toDouble()) })
                    putMap("bottomLeft",  Arguments.createMap().apply { putDouble("x", floats[7].toDouble()); putDouble("y", floats[8].toDouble()) })
                }
                result.putMap("corners", corners)
            } else {
                result.putNull("corners")
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DETECTION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun cropAndCorrectPerspective(
        filePath: String,
        x0: Double, y0: Double,
        x1: Double, y1: Double,
        x2: Double, y2: Double,
        x3: Double, y3: Double,
        promise: Promise
    ) {
        try {
            // Ensure pixels are in the correct orientation before OpenCV reads the file.
            // correctOrientation is a no-op when there is no EXIF rotation, so it is safe
            // to call even on files already processed by detectDocumentInImage.
            val cleanPath = correctOrientation(filePath).removePrefix("file://")
            val outputFile = File(reactApplicationContext.cacheDir, "scan_${System.currentTimeMillis()}.jpg")

            val ok = nativeApplyPerspectiveCorrection(
                cleanPath,
                x0.toFloat(), y0.toFloat(),
                x1.toFloat(), y1.toFloat(),
                x2.toFloat(), y2.toFloat(),
                x3.toFloat(), y3.toFloat(),
                outputFile.absolutePath
            )

            if (ok) {
                promise.resolve("file://${outputFile.absolutePath}")
            } else {
                promise.reject("CROP_ERROR", "La corrección de perspectiva falló")
            }
        } catch (e: Exception) {
            promise.reject("CROP_ERROR", e.message, e)
        }
    }

    // ─── Archivo a base64 ─────────────────────────────────────────────────────
    @ReactMethod
    fun readFileAsBase64(filePath: String, promise: Promise) {
        try {
            val cleanPath = filePath.removePrefix("file://")
            // SECURITY: only allow reading from the app's own sandbox directories
            // to prevent Broken Access Control (OWASP A01).
            val file = java.io.File(cleanPath).canonicalFile
            val cacheDir = reactApplicationContext.cacheDir.canonicalFile
            val filesDir = reactApplicationContext.filesDir.canonicalFile
            if (!file.path.startsWith(cacheDir.path) &&
                !file.path.startsWith(filesDir.path)) {
                promise.reject("ACCESS_DENIED", "Cannot read file outside app directories")
                return
            }
            val bytes = file.readBytes()
            val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            promise.resolve(base64)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    // ─── Base64 a archivo temporal ────────────────────────────────────────────
    @ReactMethod
    fun saveBase64ImageToTemp(base64: String, promise: Promise) {
        try {
            // SECURITY: reject oversized payloads to prevent OOM / disk exhaustion (OWASP A04).
            // base64 expands ~33 %, so 85 MB input ≈ 64 MB decoded — well above any real scan.
            if (base64.length > 85_000_000) {
                promise.reject("IMAGE_TOO_LARGE", "Image exceeds the 64 MB limit")
                return
            }
            val imageBytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            if (imageBytes.size > 64 * 1024 * 1024) {
                promise.reject("IMAGE_TOO_LARGE", "Decoded image exceeds the 64 MB limit")
                return
            }
            val cacheDir = reactApplicationContext.cacheDir
            val fileName = "scan_input_${System.currentTimeMillis()}.jpg"
            val outputFile = File(cacheDir, fileName)
            outputFile.writeBytes(imageBytes)
            promise.resolve("file://${outputFile.absolutePath}")
        } catch (e: Exception) {
            promise.reject("SAVE_BASE64_ERROR", e.message, e)
        }
    }
}
