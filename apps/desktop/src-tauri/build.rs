use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();
    backend_origin();
    measurement_id();
}

/// The audience-measurement property's id, written once, in brand/analytics.ts
/// (the website and the editor read it there); analytics.rs gets it from here.
fn measurement_id() {
    let file = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../../brand/analytics.ts");
    println!("cargo:rerun-if-changed={}", file.display());
    println!("cargo:rerun-if-env-changed=TRAMME_GA_API_SECRET");
    let source = fs::read_to_string(&file).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
    let id = source
        .lines()
        .find(|l| l.starts_with("export const MEASUREMENT_ID"))
        .and_then(|l| l.split('\'').nth(1))
        .unwrap_or_else(|| panic!("no MEASUREMENT_ID in {}", file.display()));
    println!("cargo:rustc-env=TRAMME_MEASUREMENT_ID={id}");
}

/// The accounts backend of this build is the app of its environment: the beta
/// app signs in at beta.app.tramme.dev, the stable one at app.tramme.dev. The
/// addresses are read from brand/environments.ts, the one table of them, by the
/// same rule as the site and the editor: TRAMME_ENV names the environment; with
/// none, a debug build (`tauri dev`) is `local` and a release build is
/// `production`; TRAMME_APP_URL sets the address by hand. It is fixed here, in
/// the binary (account.rs), so nothing at run time can point the app elsewhere.
fn backend_origin() {
    let table = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../../brand/environments.ts");
    println!("cargo:rerun-if-changed={}", table.display());
    println!("cargo:rerun-if-env-changed=TRAMME_ENV");
    println!("cargo:rerun-if-env-changed=TRAMME_APP_URL");

    let name = match env::var("TRAMME_ENV").ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(name) => name,
        None if env::var("PROFILE").as_deref() == Ok("debug") => "local".to_string(),
        None => "production".to_string(),
    };

    let source = fs::read_to_string(&table).unwrap_or_else(|e| panic!("{}: {e}", table.display()));
    // `  beta: { site: 'https://beta.tramme.dev', app: 'https://beta.app.tramme.dev' },`
    let app = source
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with(&format!("{name}: {{")))
        .and_then(|l| l.split("app: '").nth(1))
        .and_then(|rest| rest.split('\'').next())
        .map(str::to_string);
    let known: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|l| l.contains(": { site: '"))
        .filter_map(|l| l.split(':').next())
        .collect();
    let app = match env::var("TRAMME_APP_URL").ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(url) => url,
        None => app.unwrap_or_else(|| panic!("unknown environment \"{name}\" (TRAMME_ENV): one of {}", known.join(", "))),
    };
    println!("cargo:rustc-env=TRAMME_BACKEND_ORIGIN={}", app.trim_end_matches('/'));
    // the environment's name, for the audience measurement (analytics.rs): only production is measured
    println!("cargo:rustc-env=TRAMME_ENV_NAME={name}");
}
