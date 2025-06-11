# blubber-web

Live demo: https://aurabirb.github.io/blubber-web/

Project Babble (https://github.com/Project-Babble/ProjectBabble) but in the browser (and Windows app too!).  

Building: just run `npm run tauri build`. I think it needs Rust and npm, that's it. https://rustup.rs/  

The webapp sends OSC data to localhost BUT only through WebSocket, not UDP third-party software (such as an Websocket -> OSC bridge).  
The native app sends UDP data normally like the original Python app.  

Nevertheless, it's useful for debugging and connecting your ESP32-S3 XIAO Sense board and testing the EyeTrackVR firmware or checking out Project Babble even without buying the hardware (because we support your regular webcam as an input source).

This project was vibe coded in a day, so don't expect any quality code.
