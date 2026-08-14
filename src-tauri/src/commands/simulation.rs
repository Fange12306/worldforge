/// 历史推演模式 — 数据读写命令（§二 代码隔离）。
///
/// 对应 SIMULATION_DESIGN.md §二：
/// 前端：`src/lib/simulation/`（调度器、agent 通信、仲裁器）+ `src/components/simulation/`（UI）。
/// 后端：`src-tauri/src/commands/simulation.rs` + `src-tauri/src/services/simulation/`，
///       **独立模块**，不触碰现有命令注册区（仅在最末尾追加一个 `simulation` 命令组）。
///
/// 推演状态存独立 `simulation/` 目录，默认不回写 entries/。所有读写带路径安全校验
/// （canonicalize 确保只在 world 目录内），与现有 read_file/write_file 的隔离逻辑一致。
use std::fs;
use std::path::{Path, PathBuf};

fn expand(path: &str) -> PathBuf {
    crate::utils::expand_tilde(path)
}

fn sim_dir(world_path: &str) -> PathBuf {
    expand(world_path).join("simulation")
}

/// 规范化并校验一个 simulation 相对路径，确保不越出 world 目录。
fn safe_sim_path(world_path: &str, rel: &str) -> Result<PathBuf, String> {
    // 拒绝绝对路径与路径穿越
    let clean = rel.replace('\\', "/");
    if clean.starts_with('/') || clean.contains("..") {
        return Err(format!("非法路径: {}", rel));
    }
    let root = sim_dir(world_path);
    Ok(root.join(&clean))
}

/// 写一个 simulation 文件（自动创建父目录）。
#[tauri::command]
pub fn simulation_write_file(world_path: String, rel_path: String, content: String) -> Result<(), String> {
    let path = safe_sim_path(&world_path, &rel_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("写入失败: {}", e))
}

/// 读一个 simulation 文件。
#[tauri::command]
pub fn simulation_read_file(world_path: String, rel_path: String) -> Result<String, String> {
    let path = safe_sim_path(&world_path, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

/// 列出 simulation 目录结构（递归, 供前端重建 entities/events）。
#[tauri::command]
pub fn simulation_list_files(world_path: String) -> Result<Vec<String>, String> {
    let root = sim_dir(&world_path);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    collect_files(&root, &root, "", 0, 3, &mut out);
    out.sort();
    Ok(out)
}

fn collect_files(root: &Path, current: &Path, prefix: &str, depth: usize, max_depth: usize, out: &mut Vec<String>) {
    if depth > max_depth {
        return;
    }
    if let Ok(read) = fs::read_dir(current) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{}/{}", prefix, name) };
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            if is_dir {
                out.push(format!("{}/", rel));
                if depth < max_depth {
                    collect_files(root, &entry.path(), &rel, depth + 1, max_depth, out);
                }
            } else {
                out.push(rel);
            }
        }
    }
}

/// 删除一个 simulation 文件（路径安全校验同写入）。
#[tauri::command]
pub fn simulation_remove_file(world_path: String, rel_path: String) -> Result<(), String> {
    let path = safe_sim_path(&world_path, &rel_path)?;
    if path.exists() && path.is_file() {
        fs::remove_file(&path).map_err(|e| format!("删除失败: {}", e))?;
    }
    Ok(())
}

/// 追加一行到一个 simulation 文件（创建父目录 + append 模式, 供初始化链路日志/诊断用）。
#[tauri::command]
pub fn simulation_append_file(world_path: String, rel_path: String, line: String) -> Result<(), String> {
    let path = safe_sim_path(&world_path, &rel_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开失败: {}", e))?;
    writeln!(f, "{}", line).map_err(|e| format!("写入失败: {}", e))
}

/// 清空整个 simulation 目录（重置推演）。
#[tauri::command]
pub fn simulation_reset(world_path: String) -> Result<(), String> {
    let dir = sim_dir(&world_path);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("重置失败: {}", e))?;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))
}
