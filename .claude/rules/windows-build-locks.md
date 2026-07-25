# Windows build locks (debug artifacts held by the running app)

While the app is running from `npm run tauri dev`, the live process holds
`src-tauri/target/debug/build/*/out/libresource.a`. Any **debug** cargo command
that re-runs the Tauri build script then fails with:

```text
error: failed to run custom build command for `workhub`
... libresource.a
プロセスはファイルにアクセスできません。別のプロセスが使用中です。 (os error 32)
```

This is not a code error, and it is not fixed by retrying. Don't kill the dev
app to work around it — run the check against the release profile instead, which
uses a separate target directory:

```powershell
cargo clippy --release --all-targets -- -D warnings
```

`cargo test --release` is already the local default (debug test exes fail with
`STATUS_ENTRYPOINT_NOT_FOUND` on the windows-gnu toolchain), so the release
profile is the one kept warm anyway.

**Check cargo's exit code, not just its tail output.** Piping through `| tail`
replaces cargo's exit status with `tail`'s, so a failing clippy run reads as
green. Redirect to a file and echo `$?` (or `$LASTEXITCODE`) when you need the
verdict.
