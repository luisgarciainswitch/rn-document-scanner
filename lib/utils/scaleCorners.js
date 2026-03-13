function scalePoint(point, scaleX, scaleY) {
    return {
        x: point.x * scaleX,
        y: point.y * scaleY,
    };
}
export function scaleCornersToQuality(corners, analysisW, analysisH, qualityW, qualityH) {
    const scaleX = qualityW / analysisW;
    const scaleY = qualityH / analysisH;
    return {
        topLeft: scalePoint(corners.topLeft, scaleX, scaleY),
        topRight: scalePoint(corners.topRight, scaleX, scaleY),
        bottomRight: scalePoint(corners.bottomRight, scaleX, scaleY),
        bottomLeft: scalePoint(corners.bottomLeft, scaleX, scaleY),
    };
}
//# sourceMappingURL=scaleCorners.js.map