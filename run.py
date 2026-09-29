import uvicorn
import os
import sys
import socket
import subprocess
import time

def free_port(port: int) -> None:
    """Kill any process holding the given port on Windows."""
    try:
        result = subprocess.run(
            f'netstat -aon | findstr ":{port} " | findstr "LISTENING"',
            shell=True, capture_output=True, text=True
        )
        for line in result.stdout.strip().splitlines():
            parts = line.split()
            if parts:
                pid = parts[-1]
                if pid.isdigit() and int(pid) != os.getpid():
                    subprocess.run(f'taskkill /F /PID {pid}',
                                   shell=True, capture_output=True)
                    print(f"  [run.py] Freed port {port} (killed PID {pid})")
    except Exception:
        pass

def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) != 0

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if base_dir not in sys.path:
        sys.path.insert(0, base_dir)

    PORT = 8000

    # Free the port if busy
    if not is_port_free(PORT):
        print(f"  [run.py] Port {PORT} busy — freeing...")
        free_port(PORT)
        time.sleep(2)

    # If still busy after kill, try port 8001
    if not is_port_free(PORT):
        print(f"  [run.py] Port {PORT} still busy — switching to 8001")
        PORT = 8001

    print("=" * 65)
    print("  SENTINEL-AI: ADAPTIVE FACIAL & IRIS BIOMETRIC AUTHENTICATION")
    print("  YuNet + SFace ONNX | Keystroke Dynamics | Snapdragon SPU")
    print("=" * 65)
    print(f"  Backend : http://127.0.0.1:{PORT}")
    print(f"  Frontend: http://localhost:5173")
    print("=" * 65)

    uvicorn.run(
        "backend.app:app",
        host="127.0.0.1",
        port=PORT,
        reload=False,
        log_level="info",
        # Raise h11 body limit to 10 MB — webcam JPEG base64 frames are ~200 KB
        h11_max_incomplete_event_size=10 * 1024 * 1024,
    )
