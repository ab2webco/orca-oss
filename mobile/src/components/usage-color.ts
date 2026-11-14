import { colors } from '../theme/mobile-theme'

/** Same consumption bands as the usage bars and desktop barColor: green under 60, amber under 80, red from 80. */
export function usageColorOf(usedPercent: number): string {
  if (usedPercent >= 80) {
    return colors.statusRed
  }
  return usedPercent >= 60 ? colors.statusAmber : colors.statusGreen
}
