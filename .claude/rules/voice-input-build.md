---
paths:
  - "src-tauri/vendor/**"
  - "src-tauri/src/stt.rs"
  - "src-tauri/src/voice.rs"
---

# Voice input (whisper.cpp) build on windows-gnu

The voice-input feature links whisper.cpp via `whisper-rs`. Upstream
`whisper-rs-sys` does not support windows-gnu, so `src-tauri/vendor/whisper-rs-sys`
is a vendored copy (wired in through `[patch.crates-io]`) carrying three
local fixes — keep them if the vendor copy is ever updated:

1. **`/utf-8` flag gated to MSVC targets** (`build.rs`): upstream passes this
   MSVC-only flag to every Windows compiler; mingw g++ parses it as a file
   name and the cmake compiler test fails.
2. **mingw include dirs fed to bindgen** (`build.rs`, `mingw_include_dirs()`):
   libclang knows nothing about the mingw toolchain's headers; without this,
   bindgen falls back to bundled Linux bindings whose layout asserts fail.
3. **`lib` prefix restored on static archives** (`build.rs`,
   `add_lib_prefix_copies()`): whisper.cpp's cmake strips the `lib` prefix on
   WIN32 even for mingw (`ggml.a` instead of `libggml.a`), which the GNU
   linker cannot resolve. Mirrored copies are created after the cmake build.

Also: the vendored crate's `bindgen` dep is bumped to `0.72` — 0.71 emits
opaque (`_address: u8`) structs with libclang 22, breaking
`whisper_full_params`.

Build-machine requirement: LLVM (libclang) must be installed for bindgen
(`winget install LLVM.LLVM`); gcc/cmake/ninja come from the mingw64 toolchain
on PATH. GitHub windows runners have LLVM preinstalled.

`cargo check` does NOT catch linking problems with the native archives — only
`cargo build/test --release` links. Always run `cargo test --release` after
touching anything here.
