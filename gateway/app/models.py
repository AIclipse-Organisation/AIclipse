from typing import Any, Dict, Optional, Tuple

from pydantic import BaseModel


class UserContext(BaseModel):
    user_id: str
    email: Optional[str] = None
    is_admin: bool = False
    plan: Optional[int] = None
    user_name: Optional[str] = None
    token: str = ""


class UpdateImageRequest(BaseModel):
    is_public: Optional[bool] = None


SupportedFormats = Dict[str, Tuple[str, str]]
JsonDict = Dict[str, Any]
