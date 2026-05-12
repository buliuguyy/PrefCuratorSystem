from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = "sk-replace-me"
    openai_base_url: str = "https://api.openai.com/v1"
    vlm_model: str = "gpt-5.4-2026-03-05"

    ip_composer_url: str = "http://localhost:12100"

    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
