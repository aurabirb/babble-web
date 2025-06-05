use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;

mod udp;
use tauri::{Emitter, Listener};
use udp::start_udp_listener;

#[derive(Debug, Serialize, Deserialize)]
pub struct BlendshapeData {
    pub data: HashMap<String, f32>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, start_udp_listener])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.listen("send_blendshapes", |event| {
                println!("received blendshapes event");
                if let Ok(payload) = serde_json::from_str::<BlendshapeData>(&event.payload()) {
                    println!("jawOpen: {:?}", payload.data["jawOpen"]);
                }
            });

            // Optional: Start the UDP listener in a background task
            // let app_handle: AppHandle<Wry<EventLoopMessage>> = app.handle();
            // tauri::async_runtime::spawn(async move {
            //     if let Err(e) = start_udp_listener(app_handle).await {
            //         eprintln!("Error starting UDP listener: {}", e);
            //     }
            // });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    println!("tauri application running");
}
