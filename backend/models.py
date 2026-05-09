from pydantic import BaseModel


class DepartmentPayload(BaseModel):
    name: str
    color: str
