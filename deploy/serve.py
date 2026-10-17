"""Keep the single-container web, API and proxy alive or fail the container."""
import os
import signal
import subprocess
import sys
import time


def main():
    children = []

    def stop(_signum, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        children.append(subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
             "--port", "8081", "--workers", "1", "--limit-concurrency", "40"],
            cwd="/app/backend",
        ))
        children.append(subprocess.Popen(
            ["node", "server.js"], cwd="/app/web/frontend",
            env={**os.environ, "PORT": "3000", "HOSTNAME": "127.0.0.1"},
        ))
        children.append(subprocess.Popen(["nginx", "-e", "/dev/stderr", "-c", "/app/nginx.conf", "-g", "daemon off;"]))
        while True:
            for child in children:
                if child.poll() is not None:
                    raise RuntimeError(f"Service process {child.pid} exited with code {child.returncode}.")
            time.sleep(0.5)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
