"""Authentication API routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db, User, UserSettings
from app.auth import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/register", response_model=AuthResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(email=data.email, password_hash=hash_password(data.password), name=data.name)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Create default settings
    db.add(UserSettings(user_id=user.id, settings_data=_default_settings()))
    await db.commit()

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user={"id": user.id, "email": user.email, "name": user.name})


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user={"id": user.id, "email": user.email, "name": user.name})


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "name": current_user.name}


def _default_settings() -> dict:
    return {
        "ai": {"model": "gemini-1.5-pro", "temperature": 0.7, "personality": "professional"},
        "voice": {"speed": 1.0, "pitch": 1.0, "auto_speak": True, "wake_word": False},
        "memory": {"enabled": True, "auto_memory": True},
        "appearance": {"theme": "dark", "accent": "#00d4ff", "animations": "full", "compact": False},
        "privacy": {"data_retention": "forever"},
    }
