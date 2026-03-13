export type DeviceTier = 'low' | 'mid' | 'high';
export interface TierConfig {
    intervalMs: number;
    stabilityDelayMs: number;
}
export declare function getDeviceTierConfig(): Promise<TierConfig>;
//# sourceMappingURL=deviceTier.d.ts.map