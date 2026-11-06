"""Tests for ZARVIS authentication"""
import pytest
from app.auth import hash_password, verify_password, create_access_token, decode_token


def test_password_hashing():
    password = "TestPassword123!"
    hashed = hash_password(password)
    assert hashed != password
    assert verify_password(password, hashed)


def test_password_wrong():
    hashed = hash_password("correct")
    assert not verify_password("wrong", hashed)


def test_token_creation():
    token = create_access_token(user_id=1, email="test@example.com")
    assert token is not None
    assert len(token) > 20


def test_token_decode():
    token = create_access_token(user_id=42, email="test@example.com")
    payload = decode_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert payload["email"] == "test@example.com"


def test_token_invalid():
    payload = decode_token("not-a-real-token")
    assert payload is None
