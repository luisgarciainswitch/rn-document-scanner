// ios/DocumentScannerModule.mm
// Objective-C++: mezcla Objective-C (puente React Native) con C++ (OpenCV)

#import "DocumentScannerModule.h"
#import <React/RCTLog.h>

#import <opencv2/imgcodecs/ios.h>
#import <opencv2/imgproc.hpp>

#include "document_detector.hpp"

#import <UIKit/UIKit.h>

@implementation DocumentScannerModule

RCT_EXPORT_MODULE(DocumentScanner)

// ─── Corrección de orientación ────────────────────────────────────────────────
- (NSString *)correctOrientation:(NSString *)filePath {
    NSString *cleanPath = [filePath stringByReplacingOccurrencesOfString:@"file://"
                                                               withString:@""];

    UIImage *image = [UIImage imageWithContentsOfFile:cleanPath];
    if (!image) return cleanPath;

    if (image.imageOrientation == UIImageOrientationUp) {
        return cleanPath;
    }

    UIGraphicsBeginImageContextWithOptions(image.size, NO, image.scale);
    [image drawInRect:CGRectMake(0, 0, image.size.width, image.size.height)];
    UIImage *normalizedImage = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();

    if (!normalizedImage) return cleanPath;

    NSData *jpegData = UIImageJPEGRepresentation(normalizedImage, 0.95);
    [jpegData writeToFile:cleanPath atomically:YES];

    return cleanPath;
}

// ─── Detección de documento ───────────────────────────────────────────────────
RCT_EXPORT_METHOD(detectDocumentInImage:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString *cleanPath = [self correctOrientation:filePath];

    DocumentScanner::DetectionResult result;
    try {
        result = DocumentScanner::detectDocument(std::string([cleanPath UTF8String]));
    } catch (const std::exception&) {
        reject(@"DETECTION_ERROR", @"Image processing error", nil);
        return;
    }

    // Build quality dict — always present when the image is readable.
    NSDictionary *quality = @{
        @"blurScore":         @(result.quality.blurScore),
        @"brightness":        @(result.quality.brightness),
        @"isBlurry":          @(result.quality.isBlurry),
        @"isTooDark":         @(result.quality.isTooDark),
        @"isTooLight":        @(result.quality.isTooLight),
        @"isLikelyDocument":  @(result.quality.isLikelyDocument),
    };

    if (!result.detected || result.corners.size() != 4) {
        // No document detected — return quality so the caller can show warnings.
        resolve(@{
            @"corners":     [NSNull null],
            @"imageWidth":  @(result.imageWidth),
            @"imageHeight": @(result.imageHeight),
            @"quality":     quality,
        });
        return;
    }

    NSDictionary *corners = @{
        @"topLeft":     @{@"x": @(result.corners[0].x), @"y": @(result.corners[0].y)},
        @"topRight":    @{@"x": @(result.corners[1].x), @"y": @(result.corners[1].y)},
        @"bottomRight": @{@"x": @(result.corners[2].x), @"y": @(result.corners[2].y)},
        @"bottomLeft":  @{@"x": @(result.corners[3].x), @"y": @(result.corners[3].y)},
    };

    resolve(@{
        @"corners":     corners,
        @"imageWidth":  @(result.imageWidth),
        @"imageHeight": @(result.imageHeight),
        @"quality":     quality,
    });
}

// ─── Corrección de perspectiva ────────────────────────────────────────────────
RCT_EXPORT_METHOD(cropAndCorrectPerspective:(NSString *)filePath
                  x0:(double)x0 y0:(double)y0
                  x1:(double)x1 y1:(double)y1
                  x2:(double)x2 y2:(double)y2
                  x3:(double)x3 y3:(double)y3
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // Ensure pixels are in the correct orientation before OpenCV reads the file.
    // detectDocumentInImage already does this in-place; calling it again is a no-op
    // when the image is already upright (imageOrientation == Up), so it is safe.
    NSString *cleanPath = [self correctOrientation:filePath];

    NSString *outputFileName = [NSString stringWithFormat:@"scan_%lld.jpg",
                                (long long)([[NSDate date] timeIntervalSince1970] * 1000)];
    NSString *outputPath = [NSTemporaryDirectory() stringByAppendingPathComponent:outputFileName];

    std::vector<cv::Point2f> corners = {
        {(float)x0, (float)y0},
        {(float)x1, (float)y1},
        {(float)x2, (float)y2},
        {(float)x3, (float)y3}
    };

    bool ok = false;
    try {
        ok = DocumentScanner::applyPerspectiveCorrection(
            std::string([cleanPath UTF8String]),
            corners,
            std::string([outputPath UTF8String])
        );
    } catch (const std::exception&) {
        reject(@"CROP_ERROR", @"Image processing error", nil);
        return;
    }

    if (ok) {
        resolve([@"file://" stringByAppendingString:outputPath]);
    } else {
        reject(@"CROP_ERROR", @"La corrección de perspectiva falló", nil);
    }
}

// ─── Base64 a archivo temporal ────────────────────────────────────────────────
RCT_EXPORT_METHOD(saveBase64ImageToTemp:(NSString *)base64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    // SECURITY: reject oversized payloads to prevent OOM / disk exhaustion (OWASP A04).
    // base64 expands ~33 %, so 85 MB input ≈ 64 MB decoded — well above any real scan.
    if (base64.length > 85000000) {
        reject(@"IMAGE_TOO_LARGE", @"Image exceeds the 64 MB limit", nil);
        return;
    }

    NSData *imageData = [[NSData alloc]
        initWithBase64EncodedString:base64
        options:NSDataBase64DecodingIgnoreUnknownCharacters];

    if (!imageData) {
        reject(@"INVALID_BASE64", @"No se pudo decodificar la cadena base64", nil);
        return;
    }

    if (imageData.length > 64 * 1024 * 1024) {
        reject(@"IMAGE_TOO_LARGE", @"Decoded image exceeds the 64 MB limit", nil);
        return;
    }

    NSString *fileName = [NSString stringWithFormat:@"scan_input_%lld.jpg",
                          (long long)([[NSDate date] timeIntervalSince1970] * 1000)];
    NSString *outputPath = [NSTemporaryDirectory() stringByAppendingPathComponent:fileName];

    BOOL ok = [imageData writeToFile:outputPath atomically:YES];
    if (ok) {
        resolve([@"file://" stringByAppendingString:outputPath]);
    } else {
        reject(@"WRITE_ERROR", @"No se pudo escribir el archivo temporal", nil);
    }
}

// ─── Archivo a base64 ───────────────────────────────────────────────────────────────────────────────────────
RCT_EXPORT_METHOD(readFileAsBase64:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSString *cleanPath = [filePath stringByReplacingOccurrencesOfString:@"file://"
                                                               withString:@""];

    // SECURITY: restrict to the app's own sandbox directories (OWASP A01).
    NSString *canonicalPath = cleanPath.stringByResolvingSymlinksInPath;
    NSString *tmpDir = NSTemporaryDirectory().stringByResolvingSymlinksInPath;
    NSArray  *cacheDirs = NSSearchPathForDirectoriesInDomains(
        NSCachesDirectory, NSUserDomainMask, YES);
    NSString *cacheDir = [cacheDirs.firstObject stringByResolvingSymlinksInPath];
    BOOL inTmp   = tmpDir   && [canonicalPath hasPrefix:tmpDir];
    BOOL inCache = cacheDir && [canonicalPath hasPrefix:cacheDir];
    if (!inTmp && !inCache) {
        reject(@"ACCESS_DENIED", @"Cannot read file outside app directories", nil);
        return;
    }

    NSData *data = [NSData dataWithContentsOfFile:cleanPath];
    if (!data) {
        reject(@"READ_ERROR", @"No se pudo leer el archivo", nil);
        return;
    }
    resolve([data base64EncodedStringWithOptions:0]);
}

- (dispatch_queue_t)methodQueue {
    return dispatch_queue_create("com.rndocumentscanner.queue", DISPATCH_QUEUE_SERIAL);
}

@end
