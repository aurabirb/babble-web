use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;

mod udp;
use tauri::{Emitter, Listener};
use udp::{send_blendshapes, start_udp_listener, BlendshapeData};


// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_serialplugin::init())
        .invoke_handler(tauri::generate_handler![greet, send_blendshapes, start_udp_listener])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();
            app.listen("send_blendshapes", move |event| {
                println!("received blendshapes event");
                if let Ok(payload) = serde_json::from_str::<BlendshapeData>(&event.payload()) {
                    println!("jawOpen: {:?}", payload.data.get("jawOpen"));
                    println!("Sending to port: {}", payload.port);
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = send_blendshapes(handle, payload.clone()).await {
                            eprintln!("Error sending blendshapes: {}", e);
                        }
                    });
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
