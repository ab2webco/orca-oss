import { describe, expect, it } from 'vitest'
import config from '../electron-builder.config.cjs'

// Why este archivo y no un caso dentro de electron-builder-config.test.mjs: lo que
// fija acá es una separación de identidad contra nombre visible, no una opción de
// empaquetado. Si alguien "termina el rename" y toca CFBundleName, esto muere.
describe('identidad del bundle de macOS', () => {
  it('mantiene CFBundleName en Orca aunque productName cambie', () => {
    // app.getName() en empaquetado lee CFBundleName, y de ahí salen la carpeta de
    // userData y el item de llavero '<nombre> Safe Storage'. Moverlo deja cada
    // secreto guardado sin poder descifrarse, sin señal al usuario.
    expect(config.mac.extendInfo.CFBundleName).toBe('Orca')
  })

  it('muestra el nombre nuevo por CFBundleDisplayName', () => {
    expect(config.mac.extendInfo.CFBundleDisplayName).toBe(config.productName)
    expect(config.productName).toBe('Orca Lab')
  })

  it('no deja que productName sea la identidad', () => {
    // El defecto que esto cierra: electron-builder escribe productName en las dos
    // claves cuando extendInfo no las fija.
    expect(config.mac.extendInfo.CFBundleName).not.toBe(config.productName)
  })

  it('mantiene el appId, que es la otra mitad de la identidad', () => {
    expect(config.appId).toBe('com.stablyai.orca')
  })
})
