"use client";

import { Topbar } from "@/components/Topbar/Topbar";
import { InspirationGrid } from "@/components/InspirationGrid/InspirationGrid";
import { FusionStackPreview } from "@/components/FusionStackPreview/FusionStackPreview";

import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.app}>
      <Topbar />
      <main className={styles.main}>
        <section className={styles.canvas}>
          <InspirationGrid />
        </section>
        <FusionStackPreview />
      </main>
    </div>
  );
}
