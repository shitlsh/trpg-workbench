from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.storage.database import get_db
from app.models.orm import KnowledgeLibraryORM, KnowledgeDocumentORM, RuleSetORM
from app.models.schemas import KnowledgeLibrarySchema, KnowledgeLibraryCreate

router = APIRouter(prefix="/knowledge/libraries", tags=["knowledge-libraries"])


def _with_doc_count(lib: KnowledgeLibraryORM, db: Session) -> dict:
    count = db.query(KnowledgeDocumentORM).filter(KnowledgeDocumentORM.library_id == lib.id).count()
    data = KnowledgeLibrarySchema.model_validate(lib).model_dump()
    data["document_count"] = count
    return data


@router.get("", response_model=list[KnowledgeLibrarySchema])
def list_libraries(rule_set_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(KnowledgeLibraryORM)
    if rule_set_id:
        q = q.filter(KnowledgeLibraryORM.rule_set_id == rule_set_id)
    libs = q.order_by(KnowledgeLibraryORM.name).all()
    result = []
    for lib in libs:
        d = _with_doc_count(lib, db)
        result.append(d)
    return result


@router.post("", response_model=KnowledgeLibrarySchema, status_code=201)
def create_library(body: KnowledgeLibraryCreate, db: Session = Depends(get_db)):
    rs = db.get(RuleSetORM, body.rule_set_id)
    if not rs:
        raise HTTPException(status_code=404, detail="Rule set not found")
    lib = KnowledgeLibraryORM(**body.model_dump())
    db.add(lib)
    db.commit()
    db.refresh(lib)
    d = _with_doc_count(lib, db)
    return d


@router.get("/{library_id}", response_model=KnowledgeLibrarySchema)
def get_library(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    return _with_doc_count(lib, db)


@router.delete("/{library_id}", status_code=204)
def delete_library(library_id: str, db: Session = Depends(get_db)):
    lib = db.get(KnowledgeLibraryORM, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    db.delete(lib)
    db.commit()
