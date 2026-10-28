import type { Ref } from 'react'
import type { TextInputProps, TextProps } from 'react-native'
// oxlint-disable-next-line no-restricted-imports -- the one module that wraps the native components.
import { Text as NativeText, TextInput as NativeTextInput } from 'react-native'

// Why: iOS accessibility sizes reach ~3x, while icons, row heights and tab widths stay fixed.
export const MAX_FONT_SIZE_MULTIPLIER = 1.4

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
