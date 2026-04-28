"""Citation data structures."""
from dataclasses import dataclass


@dataclass
class Citation:
    chunk_id: str
    content: str
    document_id: str
    document_filename: str
    page_from: int
    page_to: int
    section_title: str | None
    relevance_score: float
    chunk_type: str | None = None

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "content": self.content,
            "document_id": self.document_id,
            "document_filename": self.document_filename,
            "page_from": self.page_from,
            "page_to": self.page_to,
            "section_title": self.section_title,
            "relevance_score": round(self.relevance_score, 4),
            "chunk_type": self.chunk_type,
        }
