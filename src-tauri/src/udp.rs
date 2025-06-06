use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::net::UdpSocket;
use tauri::{Emitter, Listener};
use rosc::{OscMessage, OscPacket, OscType, encoder};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlendshapeData {
  pub data: HashMap<String, f32>,
}

#[tauri::command]
pub async fn send_blendshapes(
    app_handle: tauri::AppHandle,
    data: BlendshapeData,
) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;

    let target = "127.0.0.1:8883".parse::<SocketAddr>().unwrap();

    // Send OSC messages for each blendshape
    for (name, value) in data.data.iter() {
        let address = format!("/avatar/parameters/{}", name);
        
        let msg = OscMessage {
            addr: address,
            args: vec![OscType::Float(*value)],
        };

        let packet = OscPacket::Message(msg);
        let msg_buf = encoder::encode(&packet)
            .map_err(|e| format!("Failed to encode OSC message: {}", e))?;

        socket
            .send_to(&msg_buf, target)
            .await
            .map_err(|e| format!("Failed to send OSC message for {}: {}", name, e))?;
    }

    Ok(())
}

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
