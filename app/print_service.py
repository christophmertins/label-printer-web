import threading

_print_lock = threading.Lock()


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

        factory = backend_factory(cfg.printer["backend"])
        return factory["list_available_devices"]()
    except Exception as exc:
        raise PrinterUnavailableError(_backend_hint(cfg, exc))


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
    return devices[0]["identifier"]


def printer_status(cfg):
    """Check whether a printer is reachable. Never raises."""
    try:
        identifier = select_identifier(cfg)
    except PrinterUnavailableError as exc:
        return {"connected": False, "error": str(exc)}
    except Exception as exc:
        return {"connected": False, "error": str(exc)}
    return {
        "connected": True,
        "identifier": identifier,
        "model": cfg.printer.get("model"),
        "backend": cfg.printer.get("backend"),
    }


def print_document(cfg, doc, render_fn):
    """Render and send a document to the printer."""
    from brother_ql.backends.helpers import send
    from brother_ql.conversion import convert
    from brother_ql.raster import BrotherQLRaster

    with _print_lock:
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
        return result