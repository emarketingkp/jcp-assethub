# Locally hosted barcode reader

Pinned package: `zxing-wasm@3.1.5` (development dependency, npm lockfile integrity retained).

Unmodified copies:

- `dist/iife/reader/index.js` → `reader.js`
- `dist/reader/zxing_reader.wasm` → `zxing_reader.wasm`
- package `LICENSE` → `LICENSE` (MIT)

`provenance.json` records source, ZXing-C++ commit, sizes and SHA-256 hashes.
The WASM hash also matches the package's exported `ZXING_WASM_SHA256`.
The reader excludes the writer distribution. ZXing-C++ and the WASM C++
wrapper use Apache 2.0; their original license texts are included as
`ZXING_CPP_LICENSE` and `ZXING_WASM_CPP_LICENSE`.

The application loads these files from its own origin on the first barcode
photo scan. The worker overrides `locateFile`; it does not fetch a CDN copy.
Do not replace these files independently of the worker and regression tests.
