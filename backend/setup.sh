#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting Local Setup for Smart Space Planner API..."

# 1. Check if Python 3 is installed
if ! command -v python3 &> /dev/null
then
    echo "❌ Python 3 could not be found. Please install Python 3.9+ and try again."
    exit 1
fi

# 2. Create Virtual Environment
if [ ! -d "venv" ]; then
    echo "📦 Creating Python virtual environment (venv)..."
    python3 -m venv venv
else
    echo "📦 Virtual environment 'venv' already exists."
fi

# 3. Activate Virtual Environment
echo "🔄 Activating virtual environment..."
source venv/bin/activate

# 4. Install Dependencies
echo "📥 Installing dependencies from requirements.txt..."
python3 -m pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "✅ Setup Complete!"
echo "------------------------------------------------------"
echo "🧠 Note: The first time you upload an image, EasyOCR"
echo "   will automatically download its language models."
echo ""
echo "To start the server manually in the future, run:"
echo "  source venv/bin/activate"
echo "  uvicorn main:app --reload"
echo "------------------------------------------------------"
echo "🚀 Starting the FastAPI server now..."

# 5. Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload