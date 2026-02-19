@echo off
echo Installing dependencies...
pip install -r "platform/backend/requirements.txt"

echo Starting Vision Trust Platform...
cd platform/backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
