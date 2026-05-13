import uuid

from fastapi import APIRouter, HTTPException

from database import supabase
from models import DepartmentPayload

router = APIRouter(prefix="/api/departments", tags=["departments"])


@router.get("")
def get_departments():
    result = supabase.table("departments").select("*").order("created_at").execute()
    return result.data


@router.post("", status_code=201)
def create_department(payload: DepartmentPayload):
    dept_id = f"dept_{uuid.uuid4().hex[:8]}"
    dept = {"id": dept_id, "name": payload.name.strip(), "color": payload.color}
    result = supabase.table("departments").insert(dept).execute()
    return result.data[0]


@router.put("/{dept_id}")
def update_department(dept_id: str, payload: DepartmentPayload):
    result = (
        supabase.table("departments")
        .update({"name": payload.name.strip(), "color": payload.color})
        .eq("id", dept_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Department not found")
    return result.data[0]


@router.delete("/{dept_id}", status_code=204)
def delete_department(dept_id: str):
    result = supabase.table("departments").delete().eq("id", dept_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Department not found")
