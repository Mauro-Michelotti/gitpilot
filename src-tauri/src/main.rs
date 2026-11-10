// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::path::PathBuf;

use gitpilot_core::accounts::AccountStore;
use gitpilot_core::settings::SettingsStore;
use tauri::Manager;

pub struct AppState {
    pub config_dir: PathBuf,
    pub accounts: AccountStore,
    pub settings: SettingsStore,
}

/// macOS menu bar: Tauri's default menu without "Close Window". Its native ⌘W
/// key equivalent would close the whole window, while the UI uses ⌘W to close
/// the current repository tab. The Edit menu must stay: without it ⌘C/⌘V/⌘X/⌘A
/// do not reach the text fields of the webview.
#[cfg(target_os = "macos")]
fn macos_menu(app: &tauri::AppHandle<tauri::Wry>) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};

    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu =
        Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos_menu);

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState {
                accounts: AccountStore::new(&dir),
                settings: SettingsStore::new(&dir),
                config_dir: dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::settings_get,
            commands::settings_save,
            commands::set_language,
            commands::repo_open,
            commands::repo_init,
            commands::repo_clone,
            commands::repo_overview,
            commands::repo_status,
            commands::repo_graph,
            commands::diff_working,
            commands::diff_commit,
            commands::commit_details,
            commands::last_commit_message,
            commands::stage,
            commands::unstage,
            commands::stage_all,
            commands::unstage_all,
            commands::discard,
            commands::discard_all,
            commands::apply_hunk,
            commands::commit,
            commands::fetch,
            commands::pull,
            commands::pull_branch,
            commands::pull_all_branches,
            commands::push,
            commands::checkout,
            commands::checkout_remote,
            commands::checkout_commit,
            commands::branch_create,
            commands::branch_delete,
            commands::branch_rename,
            commands::branch_delete_remote,
            commands::branch_set_upstream,
            commands::tag_create,
            commands::tag_delete,
            commands::tag_push,
            commands::tag_delete_remote,
            commands::remote_add,
            commands::remote_remove,
            commands::stash_save,
            commands::stash_apply,
            commands::stash_drop,
            commands::merge,
            commands::rebase,
            commands::cherry_pick,
            commands::revert,
            commands::reset,
            commands::op_continue,
            commands::op_abort,
            commands::op_skip,
            commands::conflict_load,
            commands::conflict_resolve,
            commands::conflict_take,
            commands::gitflow_suggest,
            commands::gitflow_init,
            commands::gitflow_start,
            commands::gitflow_finish,
            commands::accounts_list,
            commands::account_add,
            commands::account_remove,
            commands::provider_repos,
            commands::pull_requests,
            commands::pull_request_create,
            commands::issues,
            commands::issue_detail,
            commands::branch_issues,
            commands::branch_set_issue,
        ])
        .run(tauri::generate_context!())
        .expect("errore all'avvio di GitPilot");
}
