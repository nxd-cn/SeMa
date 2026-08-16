fn main() {
  // Ensure icon file edits re-run tauri-codegen (Dock / taskbar / .exe icon).
  println!("cargo:rerun-if-changed=icons/icon.png");
  println!("cargo:rerun-if-changed=icons/icon-mac.png");
  println!("cargo:rerun-if-changed=icons/icon.icns");
  println!("cargo:rerun-if-changed=icons/icon.ico");
  println!("cargo:rerun-if-changed=icons/32x32.png");
  println!("cargo:rerun-if-changed=icons/64x64.png");
  println!("cargo:rerun-if-changed=icons/128x128.png");
  println!("cargo:rerun-if-changed=icons/128x128@2x.png");
  println!("cargo:rerun-if-changed=tauri.conf.json");
  println!("cargo:rerun-if-changed=tauri.macos.conf.json");
  println!("cargo:rerun-if-changed=tauri.windows.conf.json");
  tauri_build::build()
}
