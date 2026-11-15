import logging

from flask import Flask, render_template

from .api import api
from .config import AppConfig


class IngressPrefix:
    """Rebuild the public path Home Assistant ingress serves the app under.

    The Supervisor strips its ingress prefix from PATH_INFO and names it in
    X-Ingress-Path; setting SCRIPT_NAME makes url_for() emit prefixed URLs.
    """

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        prefix = (environ.get("HTTP_X_INGRESS_PATH") or "").rstrip("/")
        if prefix:
            path = environ.get("PATH_INFO", "")
            if path.startswith(prefix):
                environ["PATH_INFO"] = path[len(prefix):] or "/"
            environ["SCRIPT_NAME"] = prefix
        return self.wsgi_app(environ, start_response)


def create_app():
    app = Flask(__name__)
    app.config["app_config"] = AppConfig(app.root_path)
    app.wsgi_app = IngressPrefix(app.wsgi_app)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app.register_blueprint(api)

    @app.route("/")
    def index():
        return render_template("index.html")

    return app