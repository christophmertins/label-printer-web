import base64
import io
import os

from PIL import Image, ImageDraw, ImageFont

from brother_ql.labels import FormFactor, LabelsManager

DPI = 300
PX_PER_MM = DPI / 25.4

FAMILY_FILES = {
    "sans": "DejaVuSans",
    "serif": "DejaVuSerif",
    "mono": "DejaVuSansMono",
}

_ITALIC_SUFFIX = {"serif": "Italic"}
_BOLD_SUFFIX = {False: "", True: "-Bold"}
_DEFAULT_COLOR = "#000000"


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def label_spec(label_id):
    """Look up a Label spec by identifier (works with brother_ql >= 0.9.4)."""
    for spec in LabelsManager().iter_elements():
        if spec.identifier == label_id:
            return spec
    raise ValueError(f"Unbekanntes Etikett: {label_id}")


def is_endless(spec):
    endless_factors = [FormFactor.ENDLESS]
    if hasattr(FormFactor, "PTOUCH_ENDLESS"):
        endless_factors.append(FormFactor.PTOUCH_ENDLESS)
    return spec.form_factor in endless_factors


def printable_area_mm(spec, length_mm=None):
    """Printable area of a label in millimetres.

    Die-cut labels: fixed size taken from the label spec.
    Endless tape: width from the spec, height from the user.
    """
    width = spec.dots_printable[0] / PX_PER_MM
    if spec.dots_printable[1]:
        height = spec.dots_printable[1] / PX_PER_MM
    else:
        height = clamp(length_mm if length_mm else 60.0, 10.0, 1000.0)
    return width, height


class FontResolver:
    def __init__(self, dirs):
        self.dirs = [os.path.abspath(d) for d in dirs if d and os.path.isdir(d)]
        self._cache = {}

    def _find_path(self, family, bold, italic):
        base = FAMILY_FILES.get(family, FAMILY_FILES["sans"])
        suffix = _BOLD_SUFFIX[bool(bold)]
        if italic:
            suffix += _ITALIC_SUFFIX.get(family, "Oblique")
        fname = base + suffix + ".ttf"
        for d in self.dirs:
            path = os.path.join(d, fname)
            if os.path.exists(path):
                return path
        return None

    def font(self, family, bold, italic, size_px):
        key = (family, bold, italic, int(round(size_px)))
        cached = self._cache.get(key)
        if cached:
            return cached
        try:
            path = self._find_path(family, bold, italic)
            fnt = (
                ImageFont.truetype(path, size=int(round(size_px)))
                if path
                else ImageFont.load_default()
            )
        except Exception:
            fnt = ImageFont.load_default()
        self._cache[key] = fnt
        return fnt


def render_document(cfg, doc, resolver=None):
    """Render a label document to a PIL image at 300 dpi.

    The canvas is layed out in the *printable* area of the label, so the
    pixel dimensions exactly match what brother_ql expects for the label.
    """
    if resolver is None:
        resolver = FontResolver(cfg.font_search_dirs())

    label_id = doc.get("label_id", "62")
    spec = label_spec(label_id)
    endless = is_endless(spec)

    w_mm, h_mm = printable_area_mm(spec, doc.get("label_length_mm"))
    img_w = int(round(w_mm * PX_PER_MM))
    img_h = int(round(h_mm * PX_PER_MM))

    canvas = Image.new("RGB", (img_w, img_h), "white")

    for el in doc.get("elements", []):
        if not isinstance(el, dict) or not el.get("type"):
            continue
        try:
            layer = _render_element(el, resolver)
        except Exception:
            continue
        if layer is None:
            continue

        w_px = max(1, int(round(float(el.get("w_mm", 0)) * PX_PER_MM)))
        h_px = max(1, int(round(float(el.get("h_mm", 0)) * PX_PER_MM)))
        x_px = int(round(float(el.get("x_mm", 0)) * PX_PER_MM))
        y_px = int(round(float(el.get("y_mm", 0)) * PX_PER_MM))

        rotation = float(el.get("rotation_deg", 0)) or 0.0
        if rotation:
            layer = layer.rotate(-rotation, expand=True, resample=Image.BICUBIC)
            x_px -= (layer.width - w_px) // 2
            y_px -= (layer.height - h_px) // 2

        canvas.paste(layer, (x_px, y_px), layer)

    meta = {
        "label_id": label_id,
        "label_name": spec.name,
        "endless": endless,
        "width_px": img_w,
        "height_px": img_h,
        "width_mm": round(w_mm, 2),
        "height_mm": round(h_mm, 2),
    }
    return canvas, meta


def _render_element(el, resolver):
    w_px = max(1, int(round(float(el.get("w_mm", 0)) * PX_PER_MM)))
    h_px = max(1, int(round(float(el.get("h_mm", 0)) * PX_PER_MM)))
    layer = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    etype = el.get("type")
    props = el.get("props", {}) or {}

    if etype == "text":
        _draw_text(draw, layer, props, resolver)
    elif etype == "qr":
        _draw_qr(draw, props, w_px, h_px)
    elif etype == "image":
        _draw_image(layer, props)
    return layer


def _draw_text(draw, layer, props, resolver):
    text = str(props.get("text", ""))
    if not text:
        return
    family = props.get("fontFamily", "sans")
    bold = bool(props.get("bold", False))
    italic = bool(props.get("italic", False))
    try:
        size_mm = float(props.get("fontsize_mm", 6))
    except (TypeError, ValueError):
        size_mm = 6.0
    try:
        line_height = float(props.get("lineHeight", 1.25))
    except (TypeError, ValueError):
        line_height = 1.25
    color = str(props.get("color", _DEFAULT_COLOR))
    align = props.get("align", "left")
    valign = props.get("valign", "top")

    fnt = resolver.font(family, bold, italic, size_mm * PX_PER_MM)
    lines = text.split("\n")
    line_h = size_mm * PX_PER_MM * line_height
    total_h = line_h * len(lines)
    w_px, h_px = layer.size

    if valign == "middle":
        ty = max(0.0, (h_px - total_h) / 2)
    elif valign == "bottom":
        ty = max(0.0, h_px - total_h)
    else:
        ty = 0.0

    for line in lines:
        if line:
            bbox = draw.textbbox((0, 0), line, font=fnt)
            line_w = bbox[2] - bbox[0]
            if align == "center":
                tx = (w_px - line_w) / 2
            elif align == "right":
                tx = w_px - line_w
            else:
                tx = 0
            try:
                draw.text((tx - bbox[0], ty - bbox[1]), line, font=fnt, fill=color)
            except Exception:
                draw.text((tx - bbox[0], ty - bbox[1]), line, font=fnt, fill=_DEFAULT_COLOR)
        ty += line_h


def _draw_qr(draw, props, w_px, h_px):
    value = props.get("value")
    if not value:
        return
    import qrcode
    import qrcode.constants as qr_constants

    ecl = {
        "L": qr_constants.ERROR_CORRECT_L,
        "M": qr_constants.ERROR_CORRECT_M,
        "Q": qr_constants.ERROR_CORRECT_Q,
        "H": qr_constants.ERROR_CORRECT_H,
    }.get(props.get("ecl", "M"), qr_constants.ERROR_CORRECT_M)

    qr = qrcode.QRCode(error_correction=ecl, border=0, box_size=1)
    qr.add_data(str(value))
    try:
        qr.make(fit=True)
    except qrcode.exceptions.DataOverflowError:
        return
    matrix = qr.get_matrix()
    n = len(matrix)

    try:
        quiet = clamp(int(props.get("quiet", 4)), 0, 10)
    except (TypeError, ValueError):
        quiet = 4
    modules = n + 2 * quiet
    mod = max(1, min(w_px, h_px) // modules)
    size_px = mod * modules
    ox = (w_px - size_px) // 2
    oy = (h_px - size_px) // 2

    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                x0 = ox + (col + quiet) * mod
                y0 = oy + (row + quiet) * mod
                draw.rectangle([x0, y0, x0 + mod - 1, y0 + mod - 1], fill=_DEFAULT_COLOR)


def _draw_image(layer, props):
    src = props.get("src")
    if not src:
        return
    im = _load_image_src(src)
    if im is None:
        return

    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    else:
        im = im.convert("RGB")

    w_px, h_px = layer.size
    if props.get("mode") == "stretch":
        im = im.resize((w_px, h_px), Image.LANCZOS)
        layer.paste(im, (0, 0))
    else:
        if im.width and im.height:
            r = min(w_px / im.width, h_px / im.height)
            nw, nh = max(1, int(im.width * r)), max(1, int(im.height * r))
            im = im.resize((nw, nh), Image.LANCZOS)
            layer.paste(im, ((w_px - nw) // 2, (h_px - nh) // 2))


def _load_image_src(src):
    try:
        if isinstance(src, str) and src.startswith("data:"):
            src = src.split(",", 1)[1]
        raw = base64.b64decode(src)
        return Image.open(io.BytesIO(raw))
    except Exception:
        return None


def to_png_bytes(image):
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()