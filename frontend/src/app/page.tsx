"use client";

import { Topbar } from "@/components/Topbar/Topbar";
import { Canvas } from "@/components/Canvas/Canvas";
import { Refiner } from "@/components/Refiner/Refiner";
import { ResultGallery } from "@/components/ResultGallery/ResultGallery";
import { FusionStackPreview } from "@/components/FusionStackPreview/FusionStackPreview";
import { PreviewOverlay } from "@/components/PreviewOverlay/PreviewOverlay";
import { useCurator } from "@/store/useCurator";

import styles from "./page.module.css";

export default function Home() {
  const view = useCurator((s) => s.view);

  return (
    <div className={styles.app}>
      <Topbar />
      <main className={styles.main}>
        <ResultGallery />
        <section className={styles.canvas}>
          {view === "refiner" ? <Refiner /> : <Canvas />}
        </section>
        <FusionStackPreview />
      </main>
      <PreviewOverlay />
    </div>
  );
}
