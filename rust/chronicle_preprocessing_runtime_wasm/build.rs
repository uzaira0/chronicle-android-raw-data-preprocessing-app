use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=CHRONICLE_REPOSITORY_ROOT");
    let repository_root = std::env::var_os("CHRONICLE_REPOSITORY_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"))
                .join("../..")
        });
    println!(
        "cargo:rustc-env=CHRONICLE_REPOSITORY_ROOT={}",
        repository_root.display()
    );
}
