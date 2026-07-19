---
paths:
  - "src-tauri/vendor/**"
  - "src-tauri/src/stt.rs"
  - "src-tauri/src/voice.rs"
---

# Voice input (whisper.cpp) build on windows-gnu

The voice-input feature links whisper.cpp via `whisper-rs`. Upstream
`whisper-rs-sys` does not support windows-gnu, so `src-tauri/vendor/whisper-rs-sys`
is a vendored copy (wired in through `[patch.crates-io]`) carrying five
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
4. **`vulkan-shaders-gen` linked `-static` on mingw**
   (`whisper.cpp/ggml/src/ggml-vulkan/vulkan-shaders/CMakeLists.txt`): this
   host tool runs *during* the build to generate shader sources. Linked
   dynamically it loads whichever `libstdc++-6.dll` comes first on PATH — on
   machines where Git's older `mingw64\bin` shadows the real toolchain it
   dies with `STATUS_ENTRYPOINT_NOT_FOUND` (exit code -1073741511 in the
   cmake log).
5. **libstdc++ linked statically on windows-gnu** (`build.rs`, top of
   `main()`): upstream emits `rustc-link-lib=dylib=stdc++`, so every
   produced exe (the app and the test binaries) imports `libstdc++-6.dll`
   and hits the same PATH-shadowing crash as #4 at load time — the Vulkan
   backend needs GLIBCXX symbols older Git-bundled DLLs don't have. Note a
   `.cargo/config.toml` with `-static-libstdc++` does NOT fix this (that
   flag only affects the libstdc++ the gcc driver adds implicitly, not an
   explicit `-lstdc++`).

Also: the vendored crate's `bindgen` dep is bumped to `0.72` — 0.71 emits
opaque (`_address: u8`) structs with libclang 22, breaking
`whisper_full_params`.

Build-machine requirements:

- LLVM (libclang) for bindgen (`winget install LLVM.LLVM`);
  gcc/cmake/ninja come from the mingw64 toolchain on PATH. GitHub windows
  runners have LLVM preinstalled.
- **Vulkan SDK** for the ggml Vulkan backend (whisper-rs is built with the
  `vulkan` feature): `winget install KhronosGroup.VulkanSDK`, and the
  `VULKAN_SDK` env var must point at it (the installer sets it machine-wide;
  restart the shell after installing). Provides the headers, the `vulkan-1`
  import lib, and `glslc`. CI installs it via the "Install Vulkan SDK" step
  in both workflows. At runtime whisper.cpp falls back to CPU when no usable
  Vulkan device exists — the SDK is a build-time requirement only.

`cargo check` does NOT catch linking problems with the native archives — only
`cargo build/test --release` links. Always run `cargo test --release` after
touching anything here.
