import { describe, expect, it } from 'vitest'
import config from '../electron-builder.config.cjs'

// Why este archivo y no un caso dentro de electron-builder-config.test.mjs: lo que
// fija acá es la identidad del bundle contra el nombre visible.
//
// La versión anterior de este archivo afirmaba lo contrario —CFBundleName distinto de
// productName— y así salió lab.58, que no arrancaba. Electron resuelve el helper como
// '<CFBundleName> Helper.app' y electron-builder los nombra desde productName: con los
// dos distintos, el proceso muere antes de la ventana con
// 'FATAL electron_main_delegate_mac.mm:66 Unable to find helper app'. ORCA-448.
describe('identidad del bundle de macOS', () => {
  it('no fija CFBundleName aparte de productName: Electron resuelve el helper desde ahí', () => {
    // El caso que cierra: cualquier override de CFBundleName que no sea productName
    // deja el bundle sin helper resoluble y la app no abre. Un valor igual a
    // productName es redundante pero inofensivo; distinto es un build muerto.
    const override = config.mac.extendInfo.CFBundleName
    expect(override === undefined || override === config.productName).toBe(true)
  })

  it('mantiene la identidad en Orca: userData y el llavero salen de ahí', () => {
    // app.getName() en empaquetado lee CFBundleName, que electron-builder escribe
    // desde productName. De ahí salen la carpeta de userData y el item de llavero
    // '<nombre> Safe Storage'. Moverlo deja cada secreto guardado sin poder
    // descifrarse, sin señal al usuario.
    expect(config.productName).toBe('Orca')
  })

  it('muestra el nombre nuevo por CFBundleDisplayName', () => {
    // Esta es la clave que el usuario lee, y es la única que cambia.
    expect(config.mac.extendInfo.CFBundleDisplayName).toBe('Orca Lab')
    expect(config.mac.extendInfo.CFBundleDisplayName).not.toBe(config.productName)
  })

  it('mantiene el appId, que es la otra mitad de la identidad', () => {
    expect(config.appId).toBe('com.stablyai.orca')
  })
})
