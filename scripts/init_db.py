"""
Quick start script — creates DB tables without needing Alembic
"""
import asyncio
import sys
sys.path.insert(0, '.')

async def main():
    from app.database import init_db
    print("Creating database tables...")
    try:
        await init_db()
        print("✓ Database tables created successfully")
    except Exception as e:
        print(f"⚠ DB init failed: {e}")
        print("  Make sure PostgreSQL is running and DATABASE_URL is configured")

if __name__ == "__main__":
    asyncio.run(main())
