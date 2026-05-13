import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "").strip()

_PLACEHOLDERS = {"", "https://your-project-ref.supabase.co", "your-anon-or-service-role-key"}

if SUPABASE_URL in _PLACEHOLDERS or SUPABASE_KEY in _PLACEHOLDERS:
    raise RuntimeError(
        "SUPABASE_URL or SUPABASE_KEY is missing or still set to a placeholder value. "
        "On Render: go to your service → Environment → add SUPABASE_URL and SUPABASE_KEY. "
        "Locally: create backend/.env with the real values from your Supabase project settings."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
