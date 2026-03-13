// src/utils/deviceTier.ts
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export type DeviceTier = 'low' | 'mid' | 'high';

export interface TierConfig {
  intervalMs: number;
  stabilityDelayMs: number;
}

const TIER_CONFIGS: Record<DeviceTier, TierConfig> = {
  low:  { intervalMs: 2000, stabilityDelayMs: 1200 },
  mid:  { intervalMs: 1500, stabilityDelayMs: 900  },
  high: { intervalMs: 1200, stabilityDelayMs: 700  },
};

export async function getDeviceTierConfig(): Promise<TierConfig> {
  if (Platform.OS === 'ios') {
    // mid tier avoids overheating while keeping detection responsive
    return TIER_CONFIGS.mid;
  }

  const [totalMemoryBytes, apiLevel] = await Promise.all([
    DeviceInfo.getTotalMemory(),
    DeviceInfo.getApiLevel(),
  ]);

  const totalMemoryGB = totalMemoryBytes / (1024 * 1024 * 1024);

  let tier: DeviceTier;

  if (totalMemoryGB < 1.5 || apiLevel < 24) {
    tier = 'low';
  } else if (totalMemoryGB < 3.0 || apiLevel < 26) {
    tier = 'mid';
  } else {
    tier = 'high';
  }

  return TIER_CONFIGS[tier];
}
