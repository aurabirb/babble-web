#!/usr/bin/env python3
import socket
import json
import datetime

def listen_udp():
    # Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(5.0)  # 5 second timeout to detect when data stops
    
    # Bind to localhost on port 8883
    server_address = ('127.0.0.1', 8883)
    print(f'Starting UDP listener on {server_address[0]}:{server_address[1]}')
    print('Waiting for UDP messages... (Press Ctrl+C to stop)')
    sock.bind(server_address)
    
    message_count = 0
    
    try:
        while True:
            try:
                data, address = sock.recvfrom(4096)
                message_count += 1
                timestamp = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
                
                print(f'\n[{timestamp}] Message #{message_count} from {address}')
                print(f'Size: {len(data)} bytes')
                
                # Try to decode as JSON
                try:
                    decoded_data = data.decode('utf-8')
                    json_data = json.loads(decoded_data)
                    
                    # Show just a few key values to avoid spam
                    sample_keys = ['jawOpen', 'mouthSmileLeft', 'tongueOut']
                    sample_data = {k: v for k, v in json_data.get('data', {}).items() if k in sample_keys}
                    
                    print(f'Sample data: {sample_data}')
                    print(f'Total blendshapes: {len(json_data.get("data", {}))}')
                    
                except (UnicodeDecodeError, json.JSONDecodeError) as e:
                    print(f'Error parsing data: {e}')
                    print(f'Raw data: {data[:100]}...' if len(data) > 100 else data)
                    
            except socket.timeout:
                print(f'[{datetime.datetime.now().strftime("%H:%M:%S")}] No data received for 5 seconds...')
                
    except KeyboardInterrupt:
        print('\nShutting down UDP listener...')
    finally:
        sock.close()

if __name__ == '__main__':
    listen_udp()
