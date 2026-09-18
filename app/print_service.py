import os
import select
import threading
import time

_print_lock = threading.Lock()

# Letzter bekannter Drucker-Zustand (aus dem Status-Rückkanal eines Drucks).
# Wird genutzt, wenn eine Live-Statusabfrage nicht möglich ist (z. B. weil der
# Drucker im Fehlerzustand keine Schreibzugriffe mehr annimmt).
_last_state = None


_ERROR_DE = {
    "No media when printing": "Kein Medium beim Drucken",
    "End of media (die-cut size only)": "Medienende (nur Etiketten)",
    "Tape cutter jam": "Schneidemesser klemmt",
    "Main unit in use (QL-560/650TD/1050)": "Gerät wird gerade benutzt",
    "Printer turned off": "Drucker ausgeschaltet",
    "High-voltage adapter (not used)": "Hochspannungsadapter",
    "Fan doesn't work (QL-1050/1060N)": "Lüfter defekt",
    "Replace media error": "Falsches/kein Medium eingelegt",
    "Expansion buffer full error": "Erweiterungspuffer voll",
    "Transmission / Communication error": "Übertragungs-/Kommunikationsfehler",
    "Communication buffer full error (not used)": "Kommunikationspuffer voll",
    "Cover opened while printing (Except QL-500)": "Abdeckung geöffnet",
    "Media cannot be fed (also when the media end is detected)": "Medium kann nicht eingezogen werden",
    "System error": "Systemfehler",
}

_MEDIA_DE = {
    "No media": "Kein Medium",
    "Continuous length tape": "Endlosband",
    "Die-cut labels": "Etiketten",
}

_STATUS_TYPE_DE = {
    "Reply to status request": "Statusantwort",
    "Printing completed": "Druck abgeschlossen",
    "Error occurred": "Fehler aufgetreten",
    "Notification": "Benachrichtigung",
    "Phase change": "Phasenwechsel",
}

_PHASE_DE = {
    "Waiting to receive": "Wartet auf Daten",
    "Printing state": "Druckt",
}


def _translate_state(parsed):
    if not isinstance(parsed, dict):
        return None
    return {
        "status_type": _STATUS_TYPE_DE.get(parsed.get("status_type"), parsed.get("status_type")),
        "phase_type": _PHASE_DE.get(parsed.get("phase_type"), parsed.get("phase_type")),
        "media_type": _MEDIA_DE.get(parsed.get("media_type"), parsed.get("media_type")),
        "media_width_mm": parsed.get("media_width"),
        "media_length_mm": parsed.get("media_length"),
        "errors": [_ERROR_DE.get(e, e) for e in parsed.get("errors", [])],
    }


def _device_writable(cfg):
    """Quick non-blocking check whether the printer accepts writes.

    Returns True if writable (or the backend can't be checked), False if the
    printer is busy/in an error state. Never raises.
    """
    if cfg.printer.get("backend") != "linux_kernel":
        return True
    try:
        identifier = select_identifier(cfg)
    except Exception:
        return False
    device = str(identifier)
    if device.startswith("file://"):
        device = device[7:]
    try:
        fd = os.open(device, os.O_RDWR | os.O_NONBLOCK)
    except Exception:
        return False
    try:
        # usblp meldet Schreibbereitschaft über select() unzuverlässig. Statt
        # dessen direkt eine Status-Anfrage schreiben: EAGAIN bedeutet, dass
        # der Drucker gerade nicht schreibbar ist (beschäftigt/Fehlerzustand).
        try:
            os.write(fd, b"\x1b\x69\x53")
        except (BlockingIOError, OSError):
            return False
        # Antwort abholen und verwerfen, damit der Lesepuffer sauber bleibt.
        end = time.time() + 0.8
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if not r:
                continue
            try:
                if os.read(fd, 64):
                    break
            except Exception:
                break
        return True
    finally:
        try:
            os.close(fd)
        except Exception:
            pass


class PrinterUnavailableError(Exception):
    pass


class LabelError(Exception):
    pass


def discover_devices(cfg):
    """Try to list attached Brother printers.

    Raises PrinterUnavailableError with a useful message when the backend
    cannot be used or no printer is found. Never raises any other exception.
    """
    try:
        from brother_ql.backends import backend_factory

        if cfg.printer.get("backend") == "pyusb" and not _print_lock.locked():
            # libusb cacht die Geräteliste im langlaufenden Prozess (kein udev/
            # netlink-Hotplug im Container). Vor jeder Enumeration den Kontext
            # zurücksetzen, damit USB-Hotplug zuverlässig erkannt wird.
            # Während eines laufenden Drucks (Lock gehalten) überspringen.
            _force_libusb_reinit()
        factory = backend_factory(cfg.printer["backend"])
        return factory["list_available_devices"]()
    except Exception as exc:
        raise PrinterUnavailableError(_backend_hint(cfg, exc))


def _force_libusb_reinit():
    """Reset the libusb context so the next enumeration is fresh.

    Uses pyusb's private backend handle; guarded so a version mismatch
    degrades gracefully (just no re-init)."""
    try:
        import usb.backend.libusb1 as libusb1

        obj = getattr(libusb1, "_lib_object", None)
        if obj is None:
            return
        # finalize() statt _finalize_object(): geht durch die Idempotenz-Guard,
        # sonst wird libusb_exit doppelt aufgerufen (SIGBUS).
        try:
            obj.finalize()
        except Exception:
            pass
        libusb1._lib_object = None
    except Exception:
        pass


def _backend_hint(cfg, exc):
    backend = cfg.printer.get("backend")
    if backend == "pyusb":
        name = type(exc).__name__
        if name == "NoBackendError":
            return (
                "USB-Backend nicht verfügbar (libusb fehlt im System). "
                "Unter macOS: `brew install libusb`. Die App selbst läuft "
                "weiter – nur Drucken erfordert das Backend."
            )
    if "NoBusError" in repr(exc) or "not found" in str(exc).lower():
        return str(exc)
    return (
        f"Kein Brother-Drucker gefunden (Backend: {backend}). "
        "Drucker einschalten und per USB verbinden?"
    )


def select_identifier(cfg):
    """Return the backend identifier of the printer to use.

    Raises PrinterUnavailableError if no printer is configured/attached.
    """
    configured = cfg.printer.get("printer")
    if configured:
        return configured
    devices = discover_devices(cfg)
    if not devices:
        raise PrinterUnavailableError(
            "Kein Brother-Drucker gefunden. Ist der Drucker eingeschaltet "
            "und per USB verbunden?"
        )
    identifier = devices[0]["identifier"]
    if cfg.printer.get("backend") == "pyusb":
        identifier = _normalize_pyusb_identifier(identifier)
    return identifier


def _normalize_pyusb_identifier(identifier):
    """Normalize brother_ql's pyusb identifier.

    brother_ql 0.9.4's ``list_available_devices()`` returns
    ``usb://0xVVVV:0xPPPP_<serial>``, but ``BrotherQLBackendPyUSB`` parses
    ``usb://0xVVVV:0xPPPP[/<serial>]``. Strip the underscore suffix so the
    identifier stays parseable (vendor/product alone is sufficient).
    """
    s = str(identifier)
    if s.startswith("usb://"):
        s = "usb://" + s[6:].partition("_")[0]
    return s


def _parse_usb_identifier(identifier):
    s = str(identifier)
    if s.startswith("usb://"):
        s = s[6:]
    vp = s.partition("/")[0].partition("_")[0]
    vendor, _, product = vp.partition(":")
    try:
        return int(vendor, 16), int(product, 16)
    except Exception:
        return None, None


def _query_status_linux_kernel(identifier):
    """Status-Abfrage über den linux_kernel-Backend (direkt auf /dev/usb/lp0)."""
    try:
        from brother_ql.reader import interpret_response
    except Exception:
        return None

    device = str(identifier)
    if device.startswith("file://"):
        device = device[7:]

    try:
        # O_NONBLOCK: sonst kann schon das open() blockieren, wenn der Drucker
        # im Fehlerzustand ist oder gerade beschäftigt ist.
        fd = os.open(device, os.O_RDWR | os.O_NONBLOCK)
    except Exception:
        return None
    try:
        try:
            os.write(fd, b"\x1b\x69\x53")
        except (BlockingIOError, OSError):
            return None
        data = b""
        start = time.time()
        while len(data) < 32 and time.time() - start < 2.0:
            r, _, _ = select.select([fd], [], [], 0.1)
            if not r:
                continue
            try:
                chunk = os.read(fd, 32)
            except Exception:
                break
            if chunk:
                data += chunk
        if len(data) < 32:
            return None
        return interpret_response(data)
    except Exception:
        return None
    finally:
        try:
            os.close(fd)
        except Exception:
            pass


def _query_status_pyusb(identifier):
    """Status-Abfrage über libusb (pyusb)."""
    import usb.core
    import usb.util

    try:
        from brother_ql.reader import interpret_response
    except Exception:
        return None

    vendor, product = _parse_usb_identifier(identifier)
    if not vendor:
        return None

    dev = None
    data = b""
    try:
        dev = usb.core.find(idVendor=vendor, idProduct=product)
        if dev is None:
            return None
        try:
            if dev.is_kernel_driver_active(0):
                dev.detach_kernel_driver(0)
        except Exception:
            pass
        try:
            dev.set_configuration()
        except Exception:
            pass
        cfg = dev.get_active_configuration()
        intf = usb.util.find_descriptor(cfg, bInterfaceClass=7)
        if intf is None:
            return None
        ep_out = usb.util.find_descriptor(intf, custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT)
        ep_in = usb.util.find_descriptor(intf, custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN)
        if ep_out is None or ep_in is None:
            return None
        try:
            usb.util.claim_interface(dev, intf.bInterfaceNumber)
        except Exception:
            return None
        try:
            ep_out.write(b"\x1b\x69\x53", timeout=1000)
            try:
                data = bytes(ep_in.read(32, timeout=2000))
            except Exception:
                data = b""
        finally:
            try:
                usb.util.release_interface(dev, intf.bInterfaceNumber)
            except Exception:
                pass
    except Exception:
        data = b""
    finally:
        if dev is not None:
            try:
                usb.util.dispose_resources(dev)
            except Exception:
                pass

    if not data or len(data) < 32:
        return None
    try:
        return interpret_response(data)
    except Exception:
        return None


def read_printer_status(cfg):
    """Query the printer's live status, media info and error flags.

    Works for the ``linux_kernel`` and ``pyusb`` backends. Uses timeouts so it
    never blocks for long, and returns ``None`` when no status could be read.
    Never raises. On success the state is cached as the last known state.
    """
    global _last_state
    backend = cfg.printer.get("backend")
    try:
        identifier = select_identifier(cfg)
    except Exception:
        return None

    if backend == "linux_kernel":
        parsed = _query_status_linux_kernel(identifier)
    elif backend == "pyusb":
        # libusb beansprucht das Interface; Kollision mit einem laufenden
        # Druck vermeiden (dieser hält den Print-Lock).
        if not _print_lock.acquire(blocking=False):
            return None
        try:
            parsed = _query_status_pyusb(identifier)
        finally:
            _print_lock.release()
    else:
        return None

    state = _translate_state(parsed)
    if state is not None:
        _last_state = state
    return state


def printer_status(cfg):
    """Check whether a printer is reachable. Never raises."""
    try:
        identifier = select_identifier(cfg)
    except PrinterUnavailableError as exc:
        return {"connected": False, "error": str(exc), "state": None}
    except Exception as exc:
        return {"connected": False, "error": str(exc), "state": None}
    return {
        "connected": True,
        "identifier": identifier,
        "model": cfg.printer.get("model"),
        "backend": cfg.printer.get("backend"),
        "state": read_printer_status(cfg) or _last_state,
    }


def print_document(cfg, doc, render_fn):
    """Render and send a document to the printer."""
    global _last_state
    from brother_ql.backends.helpers import send
    from brother_ql.conversion import convert
    from brother_ql.raster import BrotherQLRaster

    with _print_lock:
        if cfg.printer.get("backend") == "pyusb":
            # libusb-Kontext zurücksetzen, damit auch nach einem USB-Hotplug
            # frisch enumeriert wird (der Statuspfad überspringt das hier,
            # weil dieser Thread den Lock bereits hält).
            _force_libusb_reinit()
        identifier = select_identifier(cfg)

        p = cfg.printer
        try:
            qlr = BrotherQLRaster(p.get("model", "QL-500"))
        except Exception as exc:
            raise LabelError(f"Ungültiges Druckermodell: {p.get('model')} ({exc})")

        image, _meta = render_fn(doc)
        label_id = doc.get("label_id", "62")

        try:
            instructions = convert(
                qlr,
                images=[image],
                label=label_id,
                cut=bool(p.get("cut", True)),
                dither=bool(p.get("dither", False)),
                compress=bool(p.get("compress", True)),
                dpi_600=bool(p.get("dpi_600", False)),
                hq=bool(p.get("hq", True)),
                threshold=float(p.get("threshold", 70)),
                rotate=p.get("rotate", "auto"),
            )
        except ValueError as exc:
            raise LabelError(f"Etikett kann nicht gerastert werden: {exc}")
        except Exception as exc:
            raise LabelError(f"Fehler beim Aufbereiten des Druckauftrags: {exc}")

        # Vor dem Senden prüfen, ob der Drucker schreibbar ist. Sonst blockiert
        # der Schreibzugriff, wenn der Drucker im Fehlerzustand steckt.
        if not _device_writable(cfg):
            raise PrinterUnavailableError(
                "Drucker ist beschäftigt oder im Fehlerzustand. Bitte den "
                "Fehler am Drucker beheben (z. B. Feed-Taste drücken) und "
                "erneut versuchen."
            )

        try:
            result = send(
                instructions,
                printer_identifier=identifier,
                backend_identifier=p.get("backend", "pyusb"),
                blocking=True,
            )
        except Exception as exc:
            raise PrinterUnavailableError(
                "Druckauftrag fehlgeschlagen. Ist der Drucker eingeschaltet "
                f"und bereit? ({exc})"
            )
        if isinstance(result, dict) and isinstance(result.get("printer_state"), dict):
            state = _translate_state(result["printer_state"])
            if state is not None:
                _last_state = state
                result["printer_state"]["errors"] = state["errors"]
        return result