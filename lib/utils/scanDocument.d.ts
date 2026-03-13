import type { ScanResult, ScanDocumentOptions } from '../types';
/**
 * Detecta el documento en la imagen indicada, aplica corrección de
 * perspectiva y devuelve la URI del recorte final.
 *
 * @param input  Ruta del archivo (`file:///…` o ruta sin esquema) **o**
 *               un objeto `{ base64: string }` con la imagen codificada.
 * @param options Opciones de comportamiento (ver `ScanDocumentOptions`).
 */
export declare function scanDocumentFile(input: string | {
    base64: string;
}, options?: ScanDocumentOptions): Promise<ScanResult>;
//# sourceMappingURL=scanDocument.d.ts.map