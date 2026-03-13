import type { Camera } from 'react-native-vision-camera';
import type { TierConfig } from '../utils/deviceTier';
interface AutoCaptureOptions {
    cameraRef: React.RefObject<Camera | null>;
    /** Ref compartido: true mientras captureQuality está en curso. */
    captureLockedRef: React.RefObject<boolean>;
    tierConfig: TierConfig;
    enabled: boolean;
    onDetected: () => void;
    onNotDetected: () => void;
}
export declare function useAutoCapture({ cameraRef, captureLockedRef, tierConfig, enabled, onDetected, onNotDetected, }: AutoCaptureOptions): void;
export {};
//# sourceMappingURL=useAutoCapture.d.ts.map