import uuid

from fastapi import APIRouter, HTTPException

from database import departments_db
from models import DepartmentPayload

router = APIRouter(prefix="/api/departments", tags=["departments"])


@router.get("")
def get_departments():
    return list(departments_db.values())


@router.post("", status_code=201)
def create_department(payload: DepartmentPayload):
    dept_id = f"dept_{uuid.uuid4().hex[:8]}"
    dept = {"id": dept_id, "name": payload.name.strip(), "color": payload.color}
    departments_db[dept_id] = dept
    return dept


@router.put("/{dept_id}")
def update_department(dept_id: str, payload: DepartmentPayload):
    if dept_id not in departments_db:
        raise HTTPException(status_code=404)
    departments_db[dept_id].update({"name": payload.name.strip(), "color": payload.color})
    return departments_db[dept_id]


@router.delete("/{dept_id}", status_code=204)
def delete_department(dept_id: str):
    if dept_id not in departments_db:
        raise HTTPException(status_code=404)
    del departments_db[dept_id]
