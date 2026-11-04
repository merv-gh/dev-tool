// Build-only adapter: embed the pinned release/sync WASM in the standalone
// worker. The stock dist deployment has no node_modules or runtime downloader.
const { newQuickJSWASMModuleFromVariant } = require('quickjs-emscripten-core');
const { QuickJSFFI } = require('@jitl/quickjs-wasmfile-release-sync/ffi');
const load = require('@jitl/quickjs-wasmfile-release-sync/emscripten-module');
const wasmBinary = require('@jitl/quickjs-wasmfile-release-sync/wasm');
let promise;
module.exports.getQuickJS = () => promise ||= newQuickJSWASMModuleFromVariant({
  type: 'sync',
  importFFI: async () => QuickJSFFI,
  importModuleLoader: async () => options => load({ ...options, wasmBinary }),
});
