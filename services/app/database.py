import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger("database")
logging.basicConfig(level=logging.INFO)

# Define declarative base
Base = declarative_base()

# Construct base Database connection URL
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    db_user = os.getenv("DB_USER", "postgres")
    db_pass = os.getenv("DB_PASS", "postgres")
    db_name = os.getenv("DB_NAME", "marketing_genai")
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("DB_PORT", "5432")
    cloud_sql_instance = os.getenv("CLOUD_SQL_CONNECTION_NAME")

    if cloud_sql_instance:
        # Production GCP Cloud Run Unix socket path connection
        DATABASE_URL = f"postgresql://{db_user}:{db_pass}@/{db_name}?host=/cloudsql/{cloud_sql_instance}"
        logger.info(f"Connecting to production Cloud SQL via unix sockets: {cloud_sql_instance}")
    else:
        # Standard local TCP connection
        DATABASE_URL = f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
        logger.info(f"Connecting to database via local TCP connection: {db_host}:{db_port}")

# Ensure the asynchronous URL uses the 'asyncpg' driver
ASYNC_DATABASE_URL = DATABASE_URL
if ASYNC_DATABASE_URL.startswith("postgresql://"):
    ASYNC_DATABASE_URL = ASYNC_DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Create SQLAlchemy connection engines
sync_engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True
)

async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True
)

# Configure Session Makers
SessionLocalSync = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)
SessionLocalAsync = sessionmaker(bind=async_engine, class_=AsyncSession, expire_on_commit=False)

# Dependency helpers
def get_db():
    """Yields a synchronous database session (used in background threads / worker)."""
    db = SessionLocalSync()
    try:
        yield db
    finally:
        db.close()

async def get_async_db():
    """Yields an asynchronous database session (used in FastAPI endpoints)."""
    async with SessionLocalAsync() as session:
        try:
            yield session
        finally:
            await session.close()
