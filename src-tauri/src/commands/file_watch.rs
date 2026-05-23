use notify::{Event, EventKind, RecursiveMode, Watcher, Config};
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// Start watching the entries/ directory for changes.
/// Emits "entries-changed" event when files are added/modified/removed.
#[tauri::command]
pub fn start_file_watch(app: AppHandle, world_path: String) -> Result<(), String> {
    let entries_path = PathBuf::from(&world_path).join("entries");
    if !entries_path.exists() {
        return Err(format!("entries/ 目录不存在: {}", entries_path.display()));
    }

    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }).map_err(|e| format!("创建文件监听失败: {}", e))?;

    watcher
        .configure(Config::default().with_poll_interval(std::time::Duration::from_secs(2)))
        .map_err(|e| format!("配置监听失败: {}", e))?;

    watcher
        .watch(&entries_path, RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败: {}", e))?;

    // Spawn a thread to process watch events
    let world = world_path.clone();
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    let is_md = event.paths.iter().any(|p| {
                        p.extension()
                            .map(|e| e == "md")
                            .unwrap_or(false)
                    });
                    if !is_md { continue; }

                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                            // Rebuild index on any change
                            if let Err(e) = crate::commands::entry_crud::update_index(&world) {
                                eprintln!("Index rebuild failed: {}", e);
                            }
                            let _ = app.emit("entries-changed", &world);
                        }
                        _ => {}
                    }
                }
                Err(e) => eprintln!("Watch error: {}", e),
            }
        }
    });

    // Leak the watcher so it stays alive (the spawned thread owns rx)
    std::mem::forget(watcher);

    Ok(())
}
