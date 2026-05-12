"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export default function Home() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d) => setHealth(`${d.status} (${d.phase})`))
      .catch((e) => setHealth(`error: ${e.message}`));
  }, []);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 16,
        padding: 32,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 28, letterSpacing: -0.5 }}>
        PrefCurator
      </h1>
      <p style={{ color: "var(--fg-1)", margin: 0 }}>
        Phase 0 scaffold — frontend ⇄ backend
      </p>
      <code
        style={{
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        backend: {health}
      </code>
    </main>
  );
}
