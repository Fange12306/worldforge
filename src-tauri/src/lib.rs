mod commands;
mod models;
mod services;
mod utils;

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
            // Entry CRUD
            entry_crud::read_entry,
            entry_crud::create_entry,
            entry_crud::update_entry,
            entry_crud::delete_entry,
            entry_crud::list_entries,
            entry_crud::read_file,
            entry_crud::write_file,
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
            // File watch
            file_watch::start_file_watch,
            // API key + config
            api_key::save_config,
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
            // LLM API proxy
            api_proxy::stream_chat,
            api_proxy::test_connection,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
