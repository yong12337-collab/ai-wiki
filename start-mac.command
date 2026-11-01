#!/bin/bash
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3가 없습니다. 터미널에서 xcode-select --install 을 실행하거나 python.org에서 Python 3를 설치하세요."
  read -p "Enter를 누르면 닫습니다."; exit 1
fi
python3 aiwiki_server.py
