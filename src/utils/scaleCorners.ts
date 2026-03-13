// src/utils/scaleCorners.ts
import type { DocumentCorners, Point } from '../types';

function scalePoint(point: Point, scaleX: number, scaleY: number): Point {
  return {
    x: point.x * scaleX,
    y: point.y * scaleY,
  };
}

export function scaleCornersToQuality(
  corners: DocumentCorners,
  analysisW: number,
  analysisH: number,
  qualityW: number,
  qualityH: number,
): DocumentCorners {
  const scaleX = qualityW / analysisW;
  const scaleY = qualityH / analysisH;

  return {
    topLeft:     scalePoint(corners.topLeft,     scaleX, scaleY),
    topRight:    scalePoint(corners.topRight,     scaleX, scaleY),
    bottomRight: scalePoint(corners.bottomRight,  scaleX, scaleY),
    bottomLeft:  scalePoint(corners.bottomLeft,   scaleX, scaleY),
  };
}
