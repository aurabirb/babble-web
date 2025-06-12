use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Emitter, Listener};
use tokio::net::UdpSocket;
use tokio::sync::Mutex;
use std::sync::OnceLock;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlendshapeData {
    pub data: HashMap<String, f32>,
    pub port: u16,
}

// Structure to manage a single persistent UDP connection
#[derive(Debug)]
struct UdpConnectionManager {
    current_socket: Option<Arc<UdpSocket>>,
    current_port: Option<u16>,
}

impl UdpConnectionManager {
    fn new() -> Self {
        Self {
            current_socket: None,
            current_port: None,
        }
    }

    async fn get_or_create_connection(&mut self, port: u16) -> Result<Arc<UdpSocket>, String> {
        // If we have a connection for the same port, reuse it
        if let (Some(socket), Some(current_port)) = (&self.current_socket, self.current_port) {
            if current_port == port {
                return Ok(socket.clone());
            }
        }

        // Port changed or no existing connection, create new one
        if self.current_socket.is_some() {
            println!("Port changed from {:?} to {}, closing existing connection", self.current_port, port);
        }

        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("Failed to bind UDP socket: {}", e))?;
        
        let socket_arc = Arc::new(socket);
        self.current_socket = Some(socket_arc.clone());
        self.current_port = Some(port);
        
        println!("Created new UDP connection for port {}", port);
        Ok(socket_arc)
    }

    fn close_connection(&mut self) {
        if self.current_socket.is_some() {
            println!("Closed UDP connection for port {:?}", self.current_port);
            self.current_socket = None;
            self.current_port = None;
        }
    }
}

// Global connection manager
static CONNECTION_MANAGER: OnceLock<Arc<Mutex<UdpConnectionManager>>> = OnceLock::new();

fn get_connection_manager() -> &'static Arc<Mutex<UdpConnectionManager>> {
    CONNECTION_MANAGER.get_or_init(|| {
        Arc::new(Mutex::new(UdpConnectionManager::new()))
    })
}

#[tauri::command]
pub async fn send_blendshapes(
    app_handle: tauri::AppHandle,
    data: BlendshapeData,
) -> Result<(), String> {
    // Get or create persistent connection for this port
    let connection_manager = get_connection_manager();
    let socket = {
        let mut manager = connection_manager.lock().await;
        manager.get_or_create_connection(data.port).await?
    };

    let target = format!("127.0.0.1:{}", data.port)
        .parse::<SocketAddr>()
        .map_err(|e| format!("Invalid target address: {}", e))?;

    // Send OSC messages for each blendshape
    for (name, value) in data.data.iter() {
        let address = format!("/{}", name);

        let msg = OscMessage {
            addr: address,
            args: vec![OscType::Float(*value)],
        };

        let packet = OscPacket::Message(msg);
        let msg_buf =
            encoder::encode(&packet).map_err(|e| format!("Failed to encode OSC message: {}", e))?;

        socket
            .send_to(&msg_buf, target)
            .await
            .map_err(|e| format!("Failed to send OSC message for {}: {}", name, e))?;
    }

    Ok(())
}

// Optional: Add a function to start listening for UDP messages if needed
#[tauri::command]
pub async fn start_udp_listener(app_handle: tauri::AppHandle) -> Result<(), String> {
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
