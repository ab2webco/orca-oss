// A minimal but genuine PE32+ image: DOS stub, COFF and optional headers, one
// .text section, no resource directory. resedit parses and rewrites this the same
// way it rewrites the packaged Orca exe, so a version-resource test can run the
// real edit on real bytes without a Windows build.

const HEADERS_SIZE = 0x400
const SECTION_RAW_SIZE = 0x200

/** @returns {Buffer} */
export function createMinimalWindowsExecutable() {
  const image = Buffer.alloc(HEADERS_SIZE + SECTION_RAW_SIZE)
  image.write('MZ', 0, 'ascii')
  image.writeUInt32LE(0x40, 0x3c) // e_lfanew
  let offset = 0x40
  image.write('PE\0\0', offset, 'ascii')
  offset += 4
  offset = writeCoffHeader(image, offset)
  offset = writeOptionalHeader(image, offset)
  writeTextSectionHeader(image, offset)
  image.fill(0xcc, HEADERS_SIZE) // int3 padding: the section needs bytes, not meaning
  return image
}

function writeCoffHeader(image, offset) {
  image.writeUInt16LE(0x8664, offset) // machine: x64
  image.writeUInt16LE(1, offset + 2) // one section
  image.writeUInt32LE(0, offset + 4) // timestamp
  image.writeUInt32LE(0, offset + 8) // symbol table
  image.writeUInt32LE(0, offset + 12) // symbol count
  image.writeUInt16LE(240, offset + 16) // optional header size (PE32+ with 16 data dirs)
  image.writeUInt16LE(0x0022, offset + 18) // executable, large address aware
  return offset + 20
}

function writeOptionalHeader(image, offset) {
  const start = offset
  image.writeUInt16LE(0x20b, offset) // PE32+
  image.writeUInt8(14, offset + 2) // linker major
  image.writeUInt32LE(SECTION_RAW_SIZE, offset + 4) // size of code
  image.writeUInt32LE(0x1000, offset + 16) // entry point
  image.writeUInt32LE(0x1000, offset + 20) // base of code
  image.writeBigUInt64LE(0x140000000n, offset + 24) // image base
  image.writeUInt32LE(0x1000, offset + 32) // section alignment
  image.writeUInt32LE(0x200, offset + 36) // file alignment
  image.writeUInt16LE(6, offset + 40) // OS major
  image.writeUInt16LE(6, offset + 48) // subsystem major
  image.writeUInt32LE(0x2000, offset + 56) // size of image
  image.writeUInt32LE(HEADERS_SIZE, offset + 60) // size of headers
  image.writeUInt16LE(2, offset + 68) // subsystem: Windows GUI
  image.writeUInt16LE(0x8160, offset + 70) // dll characteristics
  image.writeBigUInt64LE(0x100000n, offset + 72) // stack reserve
  image.writeBigUInt64LE(0x1000n, offset + 80) // stack commit
  image.writeBigUInt64LE(0x100000n, offset + 88) // heap reserve
  image.writeBigUInt64LE(0x1000n, offset + 96) // heap commit
  image.writeUInt32LE(16, offset + 108) // number of data directories (all zeroed)
  return start + 240
}

function writeTextSectionHeader(image, offset) {
  image.write('.text\0\0\0', offset, 'ascii')
  image.writeUInt32LE(SECTION_RAW_SIZE, offset + 8) // virtual size
  image.writeUInt32LE(0x1000, offset + 12) // virtual address
  image.writeUInt32LE(SECTION_RAW_SIZE, offset + 16) // raw size
  image.writeUInt32LE(HEADERS_SIZE, offset + 20) // raw offset
  image.writeUInt32LE(0x60000020, offset + 36) // code, executable, readable
}
