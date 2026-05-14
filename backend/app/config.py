from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = "sk-replace-me"
    openai_base_url: str = "https://api.openai.com/v1"
    vlm_model: str = "gpt-5.4-mini-2026-03-17"

    # Prompt-expansion model: rewrites the user's prompt into N diverse variants
    # before initial image generation. Defaults to the same VLM model since the
    # nuwaflux proxy exposes gpt-mini under the same key.
    prompt_expander_model: str = "gpt-5.4-mini-2026-03-17"

    # Gemini (nano-banana-pro) initial image generation. The nuwaflux proxy
    # exposes a Gemini-compatible endpoint under the same base URL; defaulting
    # to the OpenAI base URL means a single `.env` setup works for both.
    gemini_api_key: str = "sk-replace-me"
    gemini_base_url: str = "https://api.nuwaflux.com"
    gemini_image_model: str = "gemini-3-pro-image-preview"
    gemini_aspect_ratio: str = "1:1"
    gemini_image_size: str = "1K"

    ip_composer_url: str = "http://localhost:12100"

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
