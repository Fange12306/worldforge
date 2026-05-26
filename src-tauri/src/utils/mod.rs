use std::path::PathBuf;

/// Resolve the user's home directory across platforms.
/// Checks HOME (Unix/macOS/Git-Bash), then USERPROFILE (Windows),
/// then HOMEDRIVE+HOMEPATH (legacy Windows).
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        })
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            if drive.is_empty() || path.is_empty() {
                return None;
            }
            let mut combined = drive;
            combined.push(path);
            Some(PathBuf::from(combined))
        })
}

/// Expand a path that may start with `~/` using the cross-platform home directory.
/// If the path does not start with `~/` or the home directory cannot be resolved,
/// the path is returned unchanged.
pub fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = home_dir() {
            let home_str = home.to_string_lossy();
            return PathBuf::from(path.replacen("~", &home_str, 1));
        }
    }
    PathBuf::from(path)
}
