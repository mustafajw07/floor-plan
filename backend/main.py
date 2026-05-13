from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import departments, smart_plan, projects

app = FastAPI(title="Smart Space Planner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(departments.router)
app.include_router(smart_plan.router)
app.include_router(projects.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)