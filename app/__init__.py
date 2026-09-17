import logging

from flask import Flask, render_template

from .api import api
from .config import AppConfig


def create_app():
    app = Flask(__name__)
    app.config["app_config"] = AppConfig(app.root_path)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app.register_blueprint(api)

    @app.route("/")
    def index():
        return render_template("index.html")

    return app