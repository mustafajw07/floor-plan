import uuid
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import supabase

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProjectPayload(BaseModel):
    name: str


class PagePayload(BaseModel):
    label: str
    image_src: str
    image_width: int
    image_height: int
    spaces: List[Any]
    page_index: int
    preview_data_url: Optional[str] = None


class SaveCanvasPayload(BaseModel):
    pages: List[PagePayload]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_projects():
    result = (
        supabase.table("projects")
        .select("*")
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data


@router.post("", status_code=201)
def create_project(payload: ProjectPayload):
    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    project = {"id": project_id, "name": payload.name.strip()}
    result = supabase.table("projects").insert(project).execute()
    return result.data[0]


@router.get("/{project_id}")
def get_project(project_id: str):
    result = supabase.table("projects").select("*").eq("id", project_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return result.data[0]


@router.put("/{project_id}")
def update_project(project_id: str, payload: ProjectPayload):
    result = (
        supabase.table("projects")
        .update({"name": payload.name.strip()})
        .eq("id", project_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return result.data[0]


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str):
    result = supabase.table("projects").delete().eq("id", project_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")


@router.get("/{project_id}/pages")
def get_project_pages(project_id: str):
    result = (
        supabase.table("canvas_pages")
        .select("*")
        .eq("project_id", project_id)
        .order("page_index")
        .execute()
    )
    return result.data


@router.post("/{project_id}/pages")
def save_project_pages(project_id: str, payload: SaveCanvasPayload):
    """Replace all canvas pages for a project (upsert pattern)."""
    # Verify project exists
    proj = supabase.table("projects").select("id").eq("id", project_id).execute()
    if not proj.data:
        raise HTTPException(status_code=404, detail="Project not found")

    # Delete existing pages, then re-insert
    supabase.table("canvas_pages").delete().eq("project_id", project_id).execute()

    rows = []
    for page in payload.pages:
        rows.append({
            "id": f"page_{uuid.uuid4().hex[:8]}",
            "project_id": project_id,
            "label": page.label,
            "image_src": page.image_src,
            "image_width": page.image_width,
            "image_height": page.image_height,
            "spaces": page.spaces,
            "page_index": page.page_index,
            "preview_data_url": page.preview_data_url,
        })

    saved = []
    if rows:
        result = supabase.table("canvas_pages").insert(rows).execute()
        saved = result.data

    # Touch updated_at on project
    supabase.table("projects").update({"updated_at": "now()"}).eq("id", project_id).execute()

    return saved


@router.patch("/{project_id}/pages/{page_id}/preview")
def update_page_preview(project_id: str, page_id: str, payload: dict):
    """Update only the preview_data_url for a single canvas page."""
    preview_url = payload.get("preview_data_url")
    if preview_url is None:
        raise HTTPException(status_code=422, detail="preview_data_url is required")

    result = (
        supabase.table("canvas_pages")
        .update({"preview_data_url": preview_url})
        .eq("id", page_id)
        .eq("project_id", project_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Page not found")

    # Touch project updated_at
    supabase.table("projects").update({"updated_at": "now()"}).eq("id", project_id).execute()

    return result.data[0]
