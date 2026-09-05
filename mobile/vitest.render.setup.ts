Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Why: react-native-web sizes the window from documentElement.clientWidth/Height, which
// happy-dom keeps at 0; expose the configured viewport there so useWindowDimensions is real.
Object.defineProperties(document.documentElement, {
  clientWidth: { get: () => window.innerWidth },
  clientHeight: { get: () => window.innerHeight }
})
