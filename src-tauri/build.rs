fn main() {
    // Stamp the build date into the binary in `ddMMyyyy` format so the macOS
    // About menu can display it in parentheses next to the version. The env
    // var is read at compile time via `env!("AMQPUSH_BUILD_DATE")` in lib.rs.
    //
    // Cargo only re-runs this script when its dependencies change, so the
    // date refreshes on a `cargo clean && cargo build` or whenever something
    // forces a rebuild — exactly what we want for release builds. In dev,
    // the cached date sticks until the next clean rebuild, which keeps
    // incremental compiles fast.
    let build_date = chrono::Local::now().format("%d%m%Y").to_string();
    println!("cargo:rustc-env=AMQPUSH_BUILD_DATE={build_date}");
    println!("cargo:rerun-if-changed=build.rs");

    tauri_build::build()
}
