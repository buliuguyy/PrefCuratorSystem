"use client";

import { Topbar } from "@/components/Topbar/Topbar";
import { Canvas } from "@/components/Canvas/Canvas";
import { Refiner } from "@/components/Refiner/Refiner";
import { PersonaPanel } from "@/components/PersonaPanel/PersonaPanel";
import { AssetLibrary } from "@/components/AssetLibrary/AssetLibrary";
import { FusionStackPreview } from "@/components/FusionStackPreview/FusionStackPreview";
import { CuratorPanel } from "@/components/CuratorPanel/CuratorPanel";
import { PreviewOverlay } from "@/components/PreviewOverlay/PreviewOverlay";
import { useCurator } from "@/store/useCurator";

import styles from "./page.module.css";

export default function Home() {
  const view = useCurator((s) => s.view);

  return (
    <div className={styles.app}>
      <Topbar />
      <main className={styles.main}>
        <aside className={styles.leftSidebar}>
          <PersonaPanel />
          <AssetLibrary />
        </aside>
        <section className={styles.canvas}>
          {view === "refiner" ? <Refiner /> : <Canvas />}
        </section>
        <FusionStackPreview />
        <CuratorPanel />
      </main>
      <PreviewOverlay />
    </div>
  );
}
