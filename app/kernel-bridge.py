"""Ponte fra l'app e un kernel Jupyter (docs/plans/79).

Comandi JSON a righe su stdin, eventi JSON a righe su stdout:

  {"cmd": "start", "kernel": "python3", "cwd": "/progetto"}
  {"cmd": "execute", "run": "r1", "code": "print(1)"}
  {"cmd": "interrupt"} | {"cmd": "restart"} | {"cmd": "shutdown"}

  {"ev": "ready", "kernel": ..., "language": ..., "display": ...}
  {"ev": "missing", "what": "jupyter_client" | "kernel", ...}
  {"ev": "status", "state": "busy" | "idle"}
  {"ev": "started", "run": ..., "count": n}
  {"ev": "output", "run": ..., "output": {nbformat}}
  {"ev": "clear", "run": ..., "wait": bool}
  {"ev": "done", "run": ..., "status": "ok" | "error" | "aborted" | "dead", "count": n}
  {"ev": "dead"} | {"ev": "error", "message": ...}

Con stdin chiuso il kernel si spegne e il ponte esce.
"""

import json
import os
import queue
import sys
import threading
import time

OUT = sys.stdout
sys.stdout = sys.stderr  # un print sfuggito non rompe il protocollo

POLL = 0.05
ALIVE_EVERY = 1.0
OUTPUT_TYPES = ("stream", "display_data", "execute_result", "error")


def emit(**event):
    OUT.write(json.dumps(event) + "\n")
    OUT.flush()


try:
    from jupyter_client import KernelManager
    from jupyter_client.kernelspec import KernelSpecManager, NoSuchKernel
except ImportError:
    emit(ev="missing", what="jupyter_client")
    sys.exit(0)


def read_commands(commands):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            commands.put(json.loads(line))
        except ValueError:
            emit(ev="error", message="comando non JSON")
    commands.put({"cmd": "shutdown"})


def to_output(msg_type, content):
    """Il contenuto di un messaggio iopub come output di nbformat."""
    if msg_type == "stream":
        return {"output_type": "stream", "name": content.get("name", "stdout"), "text": content.get("text", "")}
    if msg_type == "error":
        return {"output_type": "error", "ename": content.get("ename", ""),
                "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])}
    out = {"output_type": msg_type, "data": content.get("data", {}), "metadata": content.get("metadata", {})}
    if msg_type == "execute_result":
        out["execution_count"] = content.get("execution_count")
    return out


class Bridge:
    def __init__(self):
        self.km = None
        self.kc = None
        self.runs = {}  # msg_id -> {"run", "reply", "idle", "status", "count"}
        self.next_alive = 0.0
        self.last = None  # (nome, cartella) dell'ultimo avvio: un kernel morto riparte da qui

    # ---------- comandi ----------

    def start(self, name, cwd):
        if self.km is not None:
            return
        self.last = (name, cwd)
        try:
            km = KernelManager(kernel_name=name or "python3")
            spec = km.kernel_spec
            km.start_kernel(cwd=cwd or None)
        except NoSuchKernel:
            emit(ev="missing", what="kernel", kernel=name,
                 available=sorted(KernelSpecManager().find_kernel_specs()))
            return
        except Exception as e:  # noqa: BLE001 - qualunque fallimento va all'app
            emit(ev="error", message="avvio del kernel: %s" % e)
            return
        self.km = km
        self.connect()
        if self.kc is not None:
            emit(ev="ready", kernel=name, language=spec.language, display=spec.display_name)

    def connect(self):
        kc = self.km.client()
        kc.start_channels()
        try:
            kc.wait_for_ready(timeout=60)
        except Exception as e:  # noqa: BLE001 - RuntimeError, timeout di zmq...
            emit(ev="error", message="il kernel non risponde: %s" % e)
            kc.stop_channels()
            self.discard_kernel()
            return
        self.kc = kc

    def discard_kernel(self):
        """Lascia andare un kernel fallito: il prossimo restart riparte da `last`."""
        km, self.km = self.km, None
        try:
            km.shutdown_kernel(now=True)
        except Exception as e:  # noqa: BLE001 - è già rotto, basta non lasciarlo a metà
            print("spegnimento del kernel fallito: %s" % e)

    def execute(self, run, code):
        if self.kc is None:
            emit(ev="done", run=run, status="dead", count=None)
            return
        msg_id = self.kc.execute(code, allow_stdin=False, stop_on_error=True)
        self.runs[msg_id] = {"run": run, "reply": False, "idle": False, "status": None, "count": None}

    def interrupt(self):
        if self.km is not None:
            self.km.interrupt_kernel()

    def fail_all(self, status):
        for entry in self.runs.values():
            emit(ev="done", run=entry["run"], status=status, count=None)
        self.runs = {}

    def restart(self):
        if self.km is None:
            if self.last is not None:
                self.start(*self.last)
            return
        self.fail_all("dead")
        if self.kc is not None:
            self.kc.stop_channels()
            self.kc = None
        try:
            self.km.restart_kernel(now=True)
        except Exception as e:  # noqa: BLE001 - python del kernel sparito, porte, spec rotta
            emit(ev="error", message="riavvio del kernel: %s" % e)
            self.discard_kernel()
            return
        self.connect()
        if self.kc is not None:
            spec = self.km.kernel_spec
            emit(ev="ready", kernel=self.km.kernel_name, language=spec.language, display=spec.display_name)

    def shutdown(self):
        if self.kc is not None:
            self.kc.stop_channels()
        if self.km is not None:
            self.km.shutdown_kernel(now=True)

    # ---------- messaggi del kernel ----------

    def finish(self, msg_id):
        entry = self.runs.get(msg_id)
        if entry and entry["reply"] and entry["idle"]:
            del self.runs[msg_id]
            emit(ev="done", run=entry["run"], status=entry["status"], count=entry["count"])

    def on_iopub(self, msg):
        msg_type = msg["msg_type"]
        content = msg["content"]
        parent = msg.get("parent_header", {}).get("msg_id")
        entry = self.runs.get(parent)
        if msg_type == "status":
            state = content.get("execution_state")
            if state in ("busy", "idle"):
                emit(ev="status", state=state)
            if entry and state == "idle":
                entry["idle"] = True
                self.finish(parent)
            return
        if entry is None:
            return
        if msg_type == "execute_input":
            entry["count"] = content.get("execution_count")
            emit(ev="started", run=entry["run"], count=entry["count"])
        elif msg_type == "clear_output":
            emit(ev="clear", run=entry["run"], wait=bool(content.get("wait")))
        elif msg_type in OUTPUT_TYPES:
            emit(ev="output", run=entry["run"], output=to_output(msg_type, content))

    def on_shell(self, msg):
        if msg["msg_type"] != "execute_reply":
            return
        parent = msg.get("parent_header", {}).get("msg_id")
        entry = self.runs.get(parent)
        if entry is None:
            return
        entry["reply"] = True
        entry["status"] = msg["content"].get("status")
        entry["count"] = msg["content"].get("execution_count", entry["count"])
        # Una cella annullata (errore prima di lei) non ha sempre il suo idle
        if entry["status"] == "aborted":
            entry["idle"] = True
        self.finish(parent)

    def pump(self):
        if self.kc is None:
            time.sleep(POLL)
            return
        try:
            self.on_iopub(self.kc.get_iopub_msg(timeout=POLL))
        except queue.Empty:
            pass
        while True:
            try:
                self.on_shell(self.kc.get_shell_msg(timeout=0))
            except queue.Empty:
                break
        self.check_alive()

    def check_alive(self):
        now = time.monotonic()
        if now < self.next_alive:
            return
        self.next_alive = now + ALIVE_EVERY
        if self.km is not None and not self.km.is_alive():
            self.fail_all("dead")
            self.kc.stop_channels()
            self.kc = None
            self.km = None
            emit(ev="dead")


def handle(bridge, command):
    cmd = command.get("cmd")
    if cmd == "start":
        bridge.start(command.get("kernel"), command.get("cwd"))
    elif cmd == "execute":
        bridge.execute(command.get("run"), command.get("code", ""))
    elif cmd == "interrupt":
        bridge.interrupt()
    elif cmd == "restart":
        bridge.restart()
    elif cmd == "shutdown":
        return False
    return True


def drain(bridge, commands):
    """I comandi arrivati; False con `shutdown` (o stdin chiuso)."""
    while True:
        try:
            command = commands.get_nowait()
        except queue.Empty:
            return True
        if not handle(bridge, command if isinstance(command, dict) else {}):
            return False


def main():
    commands = queue.Queue()
    threading.Thread(target=read_commands, args=(commands,), daemon=True).start()
    bridge = Bridge()
    running = True
    while running:
        try:
            running = drain(bridge, commands)
            if running:
                bridge.pump()
        except Exception as e:  # noqa: BLE001 - il ponte resta in piedi
            emit(ev="error", message=str(e))
    bridge.shutdown()
    OUT.flush()
    os._exit(0)  # senza i __del__ di jupyter_client a interprete smontato


if __name__ == "__main__":
    main()
