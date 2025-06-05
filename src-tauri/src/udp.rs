use std::net::SocketAddr;
use tokio::net::UdpSocket;
use tauri::{Emitter, Listener};



// Optional: Add a function to start listening for UDP messages if needed
#[tauri::command]
pub async fn start_udp_listener(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let socket = UdpSocket::bind("127.0.0.1:8884")
        .await
        .map_err(|e| e.to_string())?;

    let mut buf = [0u8; 1024];
    
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((size, addr)) => {
                if let Ok(data) = String::from_utf8(buf[..size].to_vec()) {
                    // Here you can emit an event to the frontend with the received data
                    app_handle
                        .emit("udp-message", data)
                        .map_err(|e| e.to_string())?;
                }
            }
            Err(e) => {
                eprintln!("Error receiving UDP message: {}", e);
            }
        }
    }
}