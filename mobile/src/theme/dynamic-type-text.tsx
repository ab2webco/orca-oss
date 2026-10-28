import type { Ref } from 'react'
import type { TextInputProps, TextProps } from 'react-native'
// oxlint-disable-next-line no-restricted-imports -- the one module that wraps the native components.
import { Text as NativeText, TextInput as NativeTextInput, useWindowDimensions } from 'react-native'

// Why: iOS accessibility sizes reach ~3x, while icons, row heights and tab widths stay fixed.
export const MAX_FONT_SIZE_MULTIPLIER = 1.4

// Why: below this width in capped-scale points, a side-by-side row splits single words (320 dp at 1.4x).
const COMPACT_TEXT_LAYOUT_WIDTH = 300

export function useCompactTextLayout(): boolean {
  const { width, fontScale } = useWindowDimensions()
  return width / Math.min(fontScale, MAX_FONT_SIZE_MULTIPLIER) < COMPACT_TEXT_LAYOUT_WIDTH
}

export type Text = NativeText
export type TextInput = NativeTextInput

export function Text({
  maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER,
  ...props
}: TextProps & { ref?: Ref<NativeText> }) {
  return <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
}

export function TextInput({
  maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER,
  ...props
}: TextInputProps & { ref?: Ref<NativeTextInput> }) {
  return <NativeTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
}
