import { describe, expect, it } from 'vitest'
import {
  PLUGIN_PANEL_IOS_WEBVIEW_PROPS,
  PLUGIN_PANEL_WEBVIEW_PROPS,
  createPanelNavigationPolicy
} from './plugin-panel-webview-policy'

describe('PLUGIN_PANEL_WEBVIEW_PROPS', () => {
  it('denies file, content, storage, cookie, popup and media access', () => {
    expect(PLUGIN_PANEL_WEBVIEW_PROPS).toMatchObject({
      originWhitelist: ['*'],
      javaScriptEnabled: true,
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      allowingReadAccessToURL: undefined,
      javaScriptCanOpenWindowsAutomatically: false,
      // false would let a target=_blank load replace the outer page on Android.
      setSupportMultipleWindows: true,
      paymentRequestEnabled: false,
      allowsPictureInPictureMediaPlayback: false,
      domStorageEnabled: false,
      incognito: true,
      cacheEnabled: false,
      thirdPartyCookiesEnabled: false,
      sharedCookiesEnabled: false,
      geolocationEnabled: false,
      mixedContentMode: 'never',
      allowsLinkPreview: false,
      allowsBackForwardNavigationGestures: false,
      mediaPlaybackRequiresUserAction: true,
      allowsInlineMediaPlayback: false,
      allowsAirPlayForMediaPlayback: false,
      allowsProtectedMedia: false,
      webviewDebuggingEnabled: false
    })
  })
})

describe('PLUGIN_PANEL_IOS_WEBVIEW_PROPS', () => {
  it('keeps data detectors off on iOS and out of the shared set Android parses', () => {
    expect(PLUGIN_PANEL_IOS_WEBVIEW_PROPS).toEqual({ dataDetectorTypes: ['none'] })
    expect(PLUGIN_PANEL_WEBVIEW_PROPS).not.toHaveProperty('dataDetectorTypes')
  })
})

describe('createPanelNavigationPolicy', () => {
  it('allows the outer page and the panel srcdoc once each, and nothing after', () => {
    const allow = createPanelNavigationPolicy()

    expect(allow({ url: 'about:blank', isTopFrame: true })).toBe(true)
    expect(allow({ url: 'about:srcdoc', isTopFrame: false })).toBe(true)
    expect(allow({ url: 'about:srcdoc', isTopFrame: false })).toBe(false)
    expect(allow({ url: 'about:blank', isTopFrame: true })).toBe(false)
  })

  it('never lets the panel or its page navigate anywhere else', () => {
    const allow = createPanelNavigationPolicy()

    expect(allow({ url: 'https://example.com/', isTopFrame: false })).toBe(false)
    expect(allow({ url: 'https://example.com/', isTopFrame: true })).toBe(false)
    expect(allow({ url: 'file:///etc/hosts', isTopFrame: true })).toBe(false)
    expect(allow({ url: 'data:text/html,x', isTopFrame: false })).toBe(false)
    expect(allow({ url: 'javascript:alert(1)', isTopFrame: false })).toBe(false)
  })
})
