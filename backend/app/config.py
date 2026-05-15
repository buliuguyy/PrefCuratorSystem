from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Direct OpenAI credentials (no proxy). Used by the VLM smart-tag and
    # prompt-expander calls. The nuwaflux proxy was 524/429-ing under our
    # generate()-time concurrent burst (4 Gemini + 4 VLM); going direct
    # against OpenAI avoids that bottleneck.
    #
    # IMPORTANT: every direct-OpenAI field uses the `raw_` prefix so we never
    # accidentally inherit a `OPENAI_*` env var leaked from the user's shell
    # (which had previously been exported to point at nuwa for other work).
    raw_openai_api_key: str = "sk-replace-me"
    raw_openai_base_url: str = "https://api.openai.com/v1"
    # If non-empty, all direct-OpenAI requests tunnel through this HTTP proxy.
    # Required when the host can't reach api.openai.com directly (e.g. the
    # Linux box has only a local SOCKS/HTTP forward at 127.0.0.1:6152).
    raw_openai_proxy: str = ""

    # Nuwaflux proxy creds (OpenAI-compatible side). Kept around for
    # rollback / experimentation. Not currently wired into any client.
    nuwa_openai_api_key: str = "sk-replace-me"
    nuwa_openai_base_url: str = "https://api.nuwaflux.com"

    vlm_model: str = "gpt-5.4-mini-2026-03-17"

    # Prompt-expansion model: rewrites the user's prompt into N diverse
    # variants before initial image generation. Defaults to the same VLM model.
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
