#!/bin/sh
# Installs mpy-cross (the real MicroPython compiler) into BlockCode/.venv for the test suite.
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade mpy-cross
.venv/bin/mpy-cross --version
