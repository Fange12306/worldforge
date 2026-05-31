mod commands;
mod models;
mod services;
mod utils;
#[cfg(target_os = "macos")]
mod tray_icon_data;

use commands::api_key;
use commands::api_proxy;
use commands::entry_crud;
use commands::file_watch;
use commands::memory;
use commands::outline;
use commands::session;
use commands::scene_analyze;
use commands::story;
use commands::consistency;
use commands::relations;
use commands::timeline;
use commands::web_search;
use commands::world_init;

#[cfg(target_os = "macos")]
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            // World management
            world_init::init_world,
            world_init::open_world,
            world_init::rename_world,
            world_init::get_world_path,
            world_init::get_worlds_dir,
            world_init::reveal_world_folder,
            world_init::delete_world,
            world_init::list_worlds,
            world_init::save_world_prompt,
            world_init::load_world_prompt,
            world_init::get_app_version,
            // Entry CRUD
            entry_crud::read_entry,
            entry_crud::create_entry,
            entry_crud::update_entry,
            entry_crud::delete_entry,
            entry_crud::list_entries,
            entry_crud::read_file,
            entry_crud::write_file,
            entry_crud::pdf_to_text,
            entry_crud::delete_directory,
            entry_crud::grep_entries,
            entry_crud::list_files,
            entry_crud::link_entries,
            // Outline (chapter-per-file)
            outline::read_outline,
            outline::read_chapter,
            outline::write_outline,
            outline::delete_chapter,
            // Story persistence
            story::save_story_meta,
            story::load_stories,
            story::delete_story_meta,
            // Session persistence
            session::append_session_message,
            session::rewrite_session_messages,
            session::load_session,
            session::list_sessions,
            session::delete_session,
            session::save_session_tokens,
            session::load_session_tokens,
            session::save_session_state,
            session::load_session_state,
            session::save_session_cache_stats,
            session::load_session_cache_stats,
            // Streaming cancellation
            api_proxy::cancel_stream,
            // File watch
            file_watch::start_file_watch,
            // API key + config
            api_key::save_config,
            api_key::save_active_model,
            api_key::load_config,
            api_key::save_api_key,
            api_key::get_api_key,
            api_key::delete_api_key,
            api_key::save_last_session,
            api_key::load_last_session,
            api_key::save_custom_prompt,
            api_key::load_custom_prompt,
            api_key::save_language,
            api_key::load_language,
            api_key::save_username,
            api_key::load_username,
            api_key::save_avatar,
            api_key::load_avatar,
            api_key::fetch_models,
            // LLM API proxy
            api_proxy::stream_chat,
            api_proxy::test_connection,
            api_proxy::single_chat,
            // Web search + fetch
            web_search::web_search,
            web_search::web_fetch,
            // Scene analysis
            scene_analyze::scene_analyze,
            // Memory system
            memory::list_memories,
            memory::read_memory,
            memory::write_memory,
            memory::delete_memory,
            // Relation graph (Phase 4)
            relations::add_relation,
            relations::remove_relation,
            relations::update_relation,
            relations::query_relations,
            relations::get_all_relations,
            relations::traverse_graph,
            // Consistency check (Phase 4)
            consistency::check_consistency,
            consistency::check_consistency_semantic,
            // Timeline & Events (Phase 5)
            timeline::create_timeline,
            timeline::update_timeline,
            timeline::delete_timeline,
            timeline::list_timelines,
            timeline::create_event,
            timeline::update_event,
            timeline::delete_event,
            timeline::list_events,
            timeline::move_event,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // Fullscreen: exit fullscreen then hide after animation
                if window.is_fullscreen().unwrap_or(false) {
                    let _ = window.set_fullscreen(false);
                    let w = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        #[cfg(target_os = "macos")]
                        let _ = w.app_handle().hide();
                        #[cfg(not(target_os = "macos"))]
                        let _ = w.hide();
                    });
                    return;
                }
                // macOS: hide the whole app so system can restore it via Dock
                #[cfg(target_os = "macos")]
                let _ = window.app_handle().hide();
                // Other platforms: just hide the window
                #[cfg(not(target_os = "macos"))]
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出 WorldForge").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            #[cfg(target_os = "macos")]
            let tray_icon = Image::new(
                tray_icon_data::TRAY_ICON_RGBA,
                tray_icon_data::TRAY_ICON_WIDTH,
                tray_icon_data::TRAY_ICON_HEIGHT,
            );
            #[cfg(not(target_os = "macos"))]
            let tray_icon = app.default_window_icon().unwrap().clone();
            let tray_builder = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu);
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon_as_template(true);
            let _tray = tray_builder
                .tooltip("WorldForge")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            #[cfg(target_os = "macos")]
                            let _ = app.show();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                #[cfg(target_os = "macos")]
                                let _ = tray.app_handle().show();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = &_event {
                let _ = _app_handle.show();
                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
